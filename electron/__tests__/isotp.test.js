const { reassembleISOTP, SF, FF, CF, FC } = require('../isotp');

// 构造一段 137 字节 UDS 响应的 ISO-TP 帧序列（BMW MSD80 实测长帧）。
function build137BSequence(canId, t0) {
  const payload = Buffer.alloc(137);
  for (let i = 0; i < 137; i++) payload[i] = i & 0xff;
  const frames = [];
  const total = payload.length;
  // 首帧：PCI = 0x10 | 高字节长度，第二字节 = 低字节长度
  const ffPci = FF | ((total >> 8) & 0x0f);
  frames.push({
    id: canId,
    timestamp: t0,
    data: Buffer.concat([Buffer.from([ffPci, total & 0xff]), payload.slice(0, 6)])
  });
  // 连续帧：每个 7 字节，序号 1,2,...
  let seq = 1;
  let offset = 6;
  while (offset < total) {
    const chunk = payload.slice(offset, offset + 7);
    frames.push({
      id: canId,
      timestamp: t0 + seq * 0.001,
      data: Buffer.concat([Buffer.from([CF | (seq & 0x0f)]), chunk])
    });
    offset += 7;
    seq++;
  }
  return frames;
}

describe('isotp.js — ISO-TP 重组', () => {
  it('单帧 SF：PCI 高 4 位=0，低 4 位为长度', () => {
    const { messages } = reassembleISOTP([
      { id: 0x7e8, timestamp: 1, data: [SF | 3, 0x22, 0xf1, 0x90] }
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].payload).toEqual(Buffer.from([0x22, 0xf1, 0x90]));
    expect(messages[0].totalLength).toBe(3);
    expect(messages[0].canId).toBe(0x7e8);
  });

  it('首帧 + 连续帧：还原完整 payload，带元数据', () => {
    const frames = build137BSequence(0x7e8, 10);
    const { messages, incomplete } = reassembleISOTP(frames);
    expect(incomplete).toHaveLength(0);
    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m.totalLength).toBe(137);
    expect(m.payload.length).toBe(137);
    expect(m.payload[0]).toBe(0x00);
    expect(m.payload[136]).toBe(136 & 0xff);
  });

  it('137B 长响应：CF 数量 = 19（首帧 6 字节 + 19×7 = 139 ≥ 137）', () => {
    const frames = build137BSequence(0x7e8, 0);
    const cfCount = frames.filter((f) => (f.data[0] & 0xf0) === CF).length;
    expect(cfCount).toBe(19);
  });

  it('连续帧序号回绕（0x2f 之后回到 0x20）', () => {
    const frames = [
      { id: 0x7e8, timestamp: 0, data: [FF, 0x0e, 1, 2, 3, 4, 5, 6] },
      { id: 0x7e8, timestamp: 0.001, data: [CF | 1, 7, 8, 9, 10, 11, 12, 13] },
      { id: 0x7e8, timestamp: 0.002, data: [CF | 2, 14, 15, 16, 17, 18, 19, 20] },
      { id: 0x7e8, timestamp: 0.003, data: [CF | 3, 21, 22, 23, 24, 25, 26, 27] },
      { id: 0x7e8, timestamp: 0.004, data: [CF | 4, 28, 29, 30, 31, 32, 33, 34] }
    ];
    const { messages } = reassembleISOTP(frames);
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.length).toBe(14);
    expect([...messages[0].payload]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('连续帧序号不匹配 → 记入 incomplete 且不再继续累加', () => {
    const frames = [
      { id: 0x7e8, timestamp: 0, data: [FF, 0x0e, 1, 2, 3, 4, 5, 6] },
      { id: 0x7e8, timestamp: 0.001, data: [CF | 3, 7, 8, 9, 10, 11, 12, 13] } // 期望 seq=1
    ];
    const { messages, incomplete } = reassembleISOTP(frames);
    expect(messages).toHaveLength(0);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].reason).toContain('sequence mismatch');
  });

  it('连续帧间隔 > 1s 判重组中断（容错，不静默丢弃）', () => {
    const frames = [
      { id: 0x7e8, timestamp: 0, data: [FF, 0x0e, 1, 2, 3, 4, 5, 6] },
      { id: 0x7e8, timestamp: 2.0, data: [CF | 1, 7, 8, 9, 10, 11, 12, 13] } // 超时
    ];
    const { messages, incomplete } = reassembleISOTP(frames, { timeoutS: 1.0 });
    expect(messages).toHaveLength(0);
    expect(incomplete.length).toBeGreaterThanOrEqual(1);
    expect(incomplete.some((i) => i.reason.includes('timeout'))).toBe(true);
  });

  it('流控帧 FC 被忽略，不污染重组', () => {
    const frames = [
      { id: 0x7e8, timestamp: 0, data: [FF, 0x0e, 1, 2, 3, 4, 5, 6] },
      { id: 0x7e8, timestamp: 0.001, data: [FC, 0x00] }, // CTS
      { id: 0x7e8, timestamp: 0.002, data: [CF | 1, 7, 8, 9, 10, 11, 12, 13] },
      { id: 0x7e8, timestamp: 0.003, data: [CF | 2, 14, 15, 16, 17, 18, 19, 20] },
      { id: 0x7e8, timestamp: 0.004, data: [CF | 3, 21, 22, 23, 24, 25, 26, 27] },
      { id: 0x7e8, timestamp: 0.005, data: [CF | 4, 28, 29, 30, 31, 32, 33, 34] }
    ];
    const { messages } = reassembleISOTP(frames);
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.length).toBe(14);
  });

  it('按 CAN ID 独立重组（请求/响应分流）', () => {
    const frames = [
      { id: 0x7e0, timestamp: 0, data: [SF | 2, 0x10, 0x03] }, // 请求
      { id: 0x7e8, timestamp: 0.01, data: [SF | 2, 0x50, 0x03] } // 响应
    ];
    const { messages } = reassembleISOTP(frames);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.canId).sort()).toEqual([0x7e0, 0x7e8]);
  });

  it('EOF 时未完成的重组记入 incomplete', () => {
    const frames = [
      { id: 0x7e8, timestamp: 0, data: [FF, 0x0e, 1, 2, 3, 4, 5, 6] } // 无后续 CF
    ];
    const { messages, incomplete } = reassembleISOTP(frames);
    expect(messages).toHaveLength(0);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].reason).toContain('end of stream');
  });
});
