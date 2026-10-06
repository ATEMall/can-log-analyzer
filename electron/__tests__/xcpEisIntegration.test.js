const fs = require('fs');
const path = require('path');
const { parseTRC } = require('../trc');
const { parseA2LDocument } = require('../a2l');
const { decodeCTO, buildDaqConfig, decodeDaq } = require('../xcp');

// XCP 素材（用户提供）：可用 XCP_EIS_DIR 覆盖；缺失时按 #22 的反假绿策略**显式跳过**
// 并打印提示，而不是静默通过。
const DEFAULT_DIR = 'D:/WPSDrive/280783754/WPS云盘/ATEMall/Tools/CAN log analyzer/a2lXCPExample/EIS example';
const DIR = process.env.XCP_EIS_DIR || DEFAULT_DIR;
const TRC = path.join(DIR, 'EIS-1.trc');
const A2L = path.join(DIR, 'FS_0GB02_0U0_000.a2l');
const has = fs.existsSync(TRC) && fs.existsSync(A2L);

if (!has) {
  console.log(`\n[SKIP] XCP 素材缺失（${DIR}），跳过 EIS 集成测试 —— 未执行即未验证，需配置 XCP_EIS_DIR 后复核。`);
}

const maybe = has ? describe : describe.skip;

maybe('XCP 集成：EIS 样例（PCAN .trc + A2L）', () => {
  let trc;
  let a2l;
  beforeAll(() => {
    trc = parseTRC(fs.readFileSync(TRC, 'utf8'));
    a2l = parseA2LDocument(fs.readFileSync(A2L, 'utf8'));
  }, 120000); // 16MB A2L + 93k 帧，给足时间

  it('PCAN .trc 可解析：帧量正确、0 解析错误', () => {
    expect(trc.messages.length).toBeGreaterThan(90000);
    expect(trc.parseErrorCount).toBe(0);
    expect(trc.headerLines.length).toBeGreaterThan(0);
  });

  it('CAN FD：DAQ 帧为 64 字节', () => {
    const fd = trc.messages.filter((m) => m.isFd);
    expect(fd.length).toBeGreaterThan(90000);
    expect(fd[0].dlc).toBe(64);
  });

  it('A2L 可解析：MEASUREMENT / CHARACTERISTIC / COMPU_METHOD 计数', () => {
    expect(a2l.stats.measurements).toBe(29648);
    expect(a2l.stats.characteristics).toBe(3127);
    expect(a2l.stats.compuMethods).toBe(211);
    expect(a2l.errors).toEqual([]); // /begin /end 全部配对
  });

  it('A2L ↔ trace 交叉验证：trace 的 DAQ CAN ID 与 A2L 的 DAQ_LIST_CAN_ID 一致', () => {
    const a2lDaq = [...new Set(a2l.xcpDaqCanIds.map((x) => x.raw))].sort((a, b) => a - b);
    const byId = new Map();
    for (const m of trc.messages) byId.set(m.id, (byId.get(m.id) || 0) + 1);
    // A2L 声明的 DAQ CAN ID（含 0x7A4 / 0x7A5）必须在 trace 中真实出现
    const present = a2lDaq.filter((id) => byId.has(id));
    expect(present.length).toBeGreaterThanOrEqual(2);
    expect(present).toContain(0x7a4);
    expect(present).toContain(0x7a5);
  });

  it('XCP 命令通道：CTO 含 DAQ 配置命令序列', () => {
    const cto = trc.messages.filter((m) => m.id === 0x7a0);
    const hist = new Map();
    for (const f of cto) { const c = decodeCTO(f.data); hist.set(c.name, (hist.get(c.name) || 0) + 1); }
    expect(hist.get('ALLOC_DAQ')).toBeGreaterThan(0);
    expect(hist.get('ALLOC_ODT')).toBeGreaterThan(0);
    expect(hist.get('ALLOC_ODT_ENTRY')).toBeGreaterThan(0);
    expect(hist.get('SET_DAQ_PTR')).toBeGreaterThan(0);
    expect(hist.get('START_STOP_DAQ_LIST')).toBeGreaterThan(0);
  });

  it('DAQ DTO：PID 可提取，帧量与 A2L 声明的 DAQ ID 对齐', () => {
    const daqFrames = trc.messages.filter((m) => m.id === 0x7a4 || m.id === 0x7a5);
    expect(daqFrames.length).toBeGreaterThan(90000);
    const cfg = buildDaqConfig(trc.messages.filter((m) => m.id === 0x7a0));
    const { samples, unknownPids } = decodeDaq(daqFrames, { ...cfg, firstPid: 0 });
    // 该样例的 ODT entry 地址由主机运行时写入（trace 内无 WRITE_DAQ），
    // 故此处只验证 PID 提取有效；ODT entry 布局需在补齐配置后再断言取值。
    const pids = new Set(daqFrames.map((f) => f.data[0]));
    expect(pids.size).toBeGreaterThan(0);
    // unknownPids 是按 PID 聚合的（{pid,count}），条数需累加
    const unknownTotal = unknownPids.reduce((a, u) => a + u.count, 0);
    expect(samples.length + unknownTotal).toBe(daqFrames.length);
  });
});
