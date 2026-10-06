const { decodeCTO, decodeResponse, buildDaqConfig, decodeDaq, resolvePid } = require('../xcp');

describe('xcp.js — XCP 帧解码', () => {
  it('CTO 命令：识别命令码与名称', () => {
    expect(decodeCTO([0xff, 0x00]).name).toBe('CONNECT');
    expect(decodeCTO([0xfd, 0, 0]).name).toBe('GET_STATUS');
    expect(decodeCTO([0xe2, 0, 0, 0, 0]).name).toBe('SET_DAQ_PTR');
    expect(decodeCTO([0xde, 1, 0, 0]).name).toBe('START_STOP_DAQ_LIST');
    expect(decodeCTO([0xd6, 0, 0]).name).toBe('ALLOC_DAQ');
    expect(decodeCTO([0xd4, 0, 0, 0, 0]).name).toBe('ALLOC_ODT_ENTRY');
  });

  it('CTO 命令：未知命令码显式标出（不静默丢弃）', () => {
    const r = decodeCTO([0xc7, 1, 2]);
    expect(r.cmd).toBe(0xc7);
    expect(r.name).toBe('UNKNOWN_0xC7');
  });

  it('响应包：RES / ERR / EV / SERV', () => {
    expect(decodeResponse([0xff, 0x01]).kind).toBe('RES');
    expect(decodeResponse([0xfe, 0x22]).kind).toBe('ERR');
    expect(decodeResponse([0xfd, 0x00]).kind).toBe('EV');
    expect(decodeResponse([0xfc]).kind).toBe('SERV');
    expect(decodeResponse([0x10, 0x00]).kind).toBe(null); // 非响应 PID
  });

  it('从 CTO 流重建 DAQ 配置（ALLOC + SET_DAQ_PTR + WRITE_DAQ）', () => {
    const cto = [
      { time: 0.01, data: [0xd6, 1, 0] },                         // ALLOC_DAQ: 1 个 DAQ list
      { time: 0.02, data: [0xd5, 0, 0, 2] },                      // ALLOC_ODT: list0 → 2 个 ODT
      { time: 0.03, data: [0xd4, 0, 0, 0, 1] },                   // ALLOC_ODT_ENTRY: list0/odt0 → 1 entry
      { time: 0.04, data: [0xe2, 0, 0, 0, 0] },                   // SET_DAQ_PTR: list0/odt0/idx0
      { time: 0.05, data: [0xe1, 0, 2, 0, 0x34, 0x12, 0, 0] },    // WRITE_DAQ: size=2, addr=0x1234
      { time: 0.06, data: [0xde, 1, 0, 0] }                       // START_STOP_DAQ_LIST: 启动 list0
    ];
    const cfg = buildDaqConfig(cto);
    expect(cfg.odtEntries).toHaveLength(1);
    expect(cfg.odtEntries[0]).toMatchObject({ daqList: 0, odt: 0, idx: 0, address: 0x1234, size: 2 });
    expect(cfg.started).toEqual([{ mode: 1, daqList: 0, time: 0.06 }]);
  });

  it('resolvePid：PID 按 DAQ list 的 ODT 数展开', () => {
    const cfg = { odtCounts: [2, 3], firstPid: 0 };
    expect(resolvePid(0, cfg)).toEqual({ daqList: 0, odt: 0 });
    expect(resolvePid(1, cfg)).toEqual({ daqList: 0, odt: 1 });
    expect(resolvePid(2, cfg)).toEqual({ daqList: 1, odt: 0 });
    expect(resolvePid(4, cfg)).toEqual({ daqList: 1, odt: 2 });
    expect(resolvePid(5, cfg).daqList).toBe(null); // 越界
  });

  it('decodeDaq：按 ODT entry 布局拆出原始值', () => {
    const cfg = {
      odtCounts: [1],
      firstPid: 0,
      odtEntries: [
        { daqList: 0, odt: 0, idx: 0, address: 0x1000, ext: 0, size: 2 },
        { daqList: 0, odt: 0, idx: 1, address: 0x1002, ext: 0, size: 1 }
      ]
    };
    // PID=0，其后依次为 2 字节（0x1234，小端：34 12）、1 字节（0x56）
    const frames = [{ time: 0.1, id: 0x7a4, data: [0x00, 0x34, 0x12, 0x56] }];
    const { samples, unknownPids } = decodeDaq(frames, cfg);
    expect(unknownPids).toEqual([]);
    expect(samples).toHaveLength(1);
    const s = samples[0];
    expect(s.pid).toBe(0);
    expect(s.daqList).toBe(0);
    expect(s.odt).toBe(0);
    expect(s.values).toEqual([
      { address: 0x1000, ext: 0, size: 2, raw: 0x1234 },
      { address: 0x1002, ext: 0, size: 1, raw: 0x56 }
    ]);
  });

  it('decodeDaq：未知 PID 计入容错而不是静默丢弃', () => {
    const cfg = { odtCounts: [1], firstPid: 0, odtEntries: [] };
    const { samples, unknownPids } = decodeDaq([{ time: 0, id: 1, data: [0x09, 1] }], cfg);
    expect(samples).toHaveLength(0);
    expect(unknownPids).toEqual([{ pid: 9, count: 1 }]);
  });
});
