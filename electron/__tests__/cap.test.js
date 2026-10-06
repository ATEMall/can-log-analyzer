const { parseCandump, hexToBytes } = require('../cap');

describe('cap.js — candump 文本解析', () => {
  it('解析三列 candump 行（epoch + 0xID + 数据）', () => {
    const text = [
      '1775602023.192750 0x140 0a0a000000000000',
      '1775602024.055013 0x6f1 12021a80',
      '1775602024.057241 0x612 f1101f5a80000007'
    ].join('\n');
    const r = parseCandump(text);
    expect(r.messages).toHaveLength(3);
    expect(r.parseErrorCount).toBe(0);
    expect(r.errorFrames).toEqual([]);
    const [a, b, c] = r.messages;
    expect(a.id).toBe(0x140);
    expect(a.data).toEqual([0x0a, 0x0a, 0, 0, 0, 0, 0, 0]);
    expect(a.isExtended).toBe(false); // 0x140 = 320 < 0x7ff(2047) → 标准帧
    expect(b.id).toBe(0x6f1);
    expect(b.data).toEqual([0x12, 0x02, 0x1a, 0x80]);
    expect(c.id).toBe(0x612);
  });

  it('时间归一化为相对会话起始秒', () => {
    const text = [
      '1775602023.192750 0x7e0 0102',
      '1775602023.692750 0x7e8 0304'
    ].join('\n');
    const r = parseCandump(text);
    expect(r.messages[0].timestamp).toBeCloseTo(0, 6);
    expect(r.messages[1].timestamp).toBeCloseTo(0.5, 6);
  });

  it('整段无空格的 HEX 也能按字节切分', () => {
    expect(hexToBytes('0a0a000000000000')).toEqual([0x0a, 0x0a, 0, 0, 0, 0, 0, 0]);
    expect(hexToBytes('f1101f5a80000007')).toEqual([0xf1, 0x10, 0x1f, 0x5a, 0x80, 0, 0, 0x07]);
  });

  it('空行与注释不计错误，格式不识别行计入容错', () => {
    const text = [
      '1775602023.1 0x7e0 0102',
      '',
      '# this is a comment',
      'garbage line not candump'
    ].join('\n');
    const r = parseCandump(text);
    expect(r.messages).toHaveLength(1);
    expect(r.parseErrorCount).toBe(1);
    expect(r.parseErrors[0].reason).toContain('格式不识别');
  });

  it('数据可空（仅有 ID）', () => {
    const r = parseCandump('1775602023.1 0x7e0');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].data).toEqual([]);
    expect(r.messages[0].dlc).toBe(0);
  });
});
