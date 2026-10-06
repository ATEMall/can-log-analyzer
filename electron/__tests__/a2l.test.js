const { parseA2LDocument, tokenize } = require('../a2l');

const MINI = `
ASAP2_VERSION 1 71
/begin PROJECT Test "Test project"
  /begin MODULE TestModule "test module"
    /begin MEASUREMENT EngSpeed "Engine speed" SWORD EngSpeed_CM 1 0 0 8000
      /begin IF_DATA CANAPE_EXT 100 0x1234
      /end IF_DATA
    /end MEASUREMENT
    /begin CHARACTERISTIC K_curve "curve" VALUE 0x2000 RL_FLOAT32_IEEE 0 EngSpeed_CM
    /end CHARACTERISTIC
    /begin COMPU_METHOD EngSpeed_CM "rpm" LINEAR "rpm" "rpm" COEFFS_LINEAR 0.125 0
    /end COMPU_METHOD
    /begin IF_DATA XCP
      /begin DAQ_LIST_CAN_ID
        FIXED 1073743780
      /end DAQ_LIST_CAN_ID
    /end IF_DATA
  /end MODULE
/end PROJECT
`;

describe('a2l.js — A2L（ASAP2）解析', () => {
  it('MEASUREMENT：名称 / 数据类型 / COMPU_METHOD / ECU 地址', () => {
    const r = parseA2LDocument(MINI);
    expect(r.measurements).toHaveLength(1);
    const m = r.measurements[0];
    expect(m.name).toBe('EngSpeed');
    expect(m.datatype).toBe('SWORD');
    expect(m.compuMethod).toBe('EngSpeed_CM');
    expect(m.address).toBe(0x1234); // IF_DATA 中 100 之后的地址
  });

  it('CHARACTERISTIC：地址与类型', () => {
    const r = parseA2LDocument(MINI);
    expect(r.characteristics).toHaveLength(1);
    expect(r.characteristics[0].name).toBe('K_curve');
    expect(r.characteristics[0].address).toBe(0x2000);
  });

  it('COMPU_METHOD：LINEAR 抽取出数值系数', () => {
    const r = parseA2LDocument(MINI);
    expect(r.compuMethods).toHaveLength(1);
    expect(r.compuMethods[0].name).toBe('EngSpeed_CM');
    expect(r.compuMethods[0].type).toBe('LINEAR');
    expect(r.compuMethods[0].coeffs).toEqual([0.125, 0]);
  });

  it('XCP DAQ_LIST_CAN_ID：深埋在 IF_DATA 内也能提取，并去掉扩展 ID 标志', () => {
    const r = parseA2LDocument(MINI);
    expect(r.xcpDaqCanIds).toHaveLength(1);
    expect(r.xcpDaqCanIds[0]).toEqual({ raw: 1956, fixed: true }); // 1073743780 - 0x40000000 = 1956 = 0x7A4
  });

  it('未识别 BLOCK 计数跳过（不静默丢弃）', () => {
    const r = parseA2LDocument('/begin SOME_FUTURE_BLOCK x y z\n/end SOME_FUTURE_BLOCK\n');
    expect(r.stats.unknownBlockCount).toBe(1);
    expect(r.unknownBlocks[0]).toEqual({ name: 'SOME_FUTURE_BLOCK', count: 1 });
  });

  it('/begin 与 /end 不配对时记录结构错误', () => {
    const r = parseA2LDocument('/begin PROJECT A\n  /begin MODULE M\n/end PROJECT\n');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.kind === 'unterminated-block' || e.kind === 'stray-end')).toBe(true);
  });

  it('tokenize 去掉块注释与行注释，保留带空格的字符串', () => {
    const toks = tokenize('a /* comment */ b // line\n "hello world"');
    expect(toks.filter((t) => t.type === 'raw').map((t) => t.value)).toEqual(['a', 'b']);
    expect(toks.find((t) => t.type === 'str').value).toBe('hello world');
  });

  it('/include 记录路径', () => {
    const r = parseA2LDocument('/begin PROJECT P ""\n /include "sub.a2l"\n/end PROJECT\n');
    expect(r.includes).toContain('sub.a2l');
    expect(r.stats.includes).toBe(1);
  });
});
