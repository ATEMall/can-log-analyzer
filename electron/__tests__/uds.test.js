const { parseUDSService, isUDSService, classifyUDSServices, parseDTCs } = require('../uds');

describe('uds.js — UDS 服务解析', () => {
  it('isUDSService 只放行已知 UDS SID（KWP2000 不解析）', () => {
    expect(isUDSService(0x10)).toBe(true);
    expect(isUDSService(0x22)).toBe(true);
    expect(isUDSService(0x7f)).toBe(true);
    expect(isUDSService(0x1a)).toBe(false); // KWP2000 ReadDiagnosticIdentification
    expect(isUDSService(0x6f)).toBe(false);
  });

  it('0x10 会话控制：子功能语义', () => {
    const r = parseUDSService(Buffer.from([0x10, 0x03]));
    expect(r.name).toBe('DiagnosticSessionControl');
    expect(r.subfunction).toBe(0x03);
    expect(r.subfunctionName).toBe('extendedDiagnosticSession');
  });

  it('0x11 ECU 复位：子功能', () => {
    const r = parseUDSService(Buffer.from([0x11, 0x01]));
    expect(r.subfunctionName).toBe('hardReset');
  });

  it('0x22 读 DID：抽取 2 字节 DID', () => {
    const r = parseUDSService(Buffer.from([0x22, 0xf1, 0x90, 0xf1, 0x91]));
    expect(r.dids).toEqual([0xf190, 0xf191]);
    expect(r.name).toBe('ReadDataByIdentifier');
  });

  it('0x27 安全访问：奇偶区分 seed/key', () => {
    const seed = parseUDSService(Buffer.from([0x27, 0x01, 0xaa, 0xbb]));
    expect(seed.isSeedRequest).toBe(true);
    expect(seed.seedLength).toBe(2);
    const key = parseUDSService(Buffer.from([0x27, 0x02, 0xcc, 0xdd]));
    expect(key.isKey).toBe(true);
    expect(key.isSeedRequest).toBe(false);
  });

  it('0x2E 写 DID：DID + 数据', () => {
    const r = parseUDSService(Buffer.from([0x2e, 0xf1, 0x90, 0x12, 0x34]));
    expect(r.did).toBe(0xf190);
    expect([...r.data]).toEqual([0x12, 0x34]);
  });

  it('0x19 DTC：3 字节组 + 故障类型 + status（0x02 带状态）', () => {
    // 0x19 0x02 + DTC(C0 01 23) + status(0x04) + DTC(C1 45 67) + status(0x08)
    const r = parseUDSService(Buffer.from([0x19, 0x02, 0xc0, 0x01, 0x23, 0x04, 0xc1, 0x45, 0x67, 0x08]));
    expect(r.subfunctionName).toBe('reportDTCByStatusMask');
    expect(r.dtcs).toHaveLength(2);
    expect(r.dtcs[0].dtcId).toBe(0xc00123);
    // faultType = (0xc0 >> 4) & 0x0f = 0x0c（noFaultTypeAvailable / 见 DTC_FAULT_TYPES）
    expect(r.dtcs[0].faultType).toBe(0x0c);
    expect(r.dtcs[0].status).toBe(0x04);
    expect(r.dtcs[1].dtcId).toBe(0xc14567);
    expect(r.dtcs[1].status).toBe(0x08);
  });

  it('0x19 0x0a 支持 DTC 列表：无 status 字节', () => {
    const r = parseUDSService(Buffer.from([0x19, 0x0a, 0xc0, 0x01, 0x23, 0xc1, 0x45, 0x67]));
    expect(r.dtcs).toHaveLength(2);
    expect(r.dtcs[0].status).toBeUndefined();
  });

  it('0x7f 负响应：NRC 单独归类', () => {
    const r = parseUDSService(Buffer.from([0x7f, 0x22, 0x33]));
    expect(r.isNegative).toBe(true);
    expect(r.requestSid).toBe(0x22);
    expect(r.requestSidName).toBe('ReadDataByIdentifier');
    expect(r.nrc).toBe(0x33);
    expect(r.nrcName).toBe('securityAccessDenied');
  });

  it('classifyUDSServices：批量解析，跳过非 UDS', () => {
    const reassembled = [
      { canId: 0x7e8, time: 0.01, payload: Buffer.from([0x50, 0x03]) }, // 正响应 0x10
      { canId: 0x7e8, time: 0.02, payload: Buffer.from([0x7f, 0x22, 0x31]) }, // 负响应
      { canId: 0x6f1, time: 0.03, payload: Buffer.from([0x1a, 0x90]) } // KWP2000，跳过
    ];
    const out = classifyUDSServices(reassembled);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('DiagnosticSessionControl');
    expect(out[1].isNegative).toBe(true);
  });

  it('parseDTCs：独立解析 3+1 结构', () => {
    const dtcs = parseDTCs(Buffer.from([0xc0, 0x01, 0x23, 0x04, 0xc1, 0x45, 0x67, 0x08]), true);
    expect(dtcs).toHaveLength(2);
    expect(dtcs[0].hex).toBe('0xC00123');
  });
});
