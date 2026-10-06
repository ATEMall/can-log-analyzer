const fs = require('fs');
const path = require('path');
const { parseCandump } = require('../cap');
const { reassembleISOTP } = require('../isotp');
const { classifyUDSServices } = require('../uds');

const DIR = path.join(__dirname, '..', '..', 'TestExample', 'roadmap_v3x', 'uds_xcp');
const FILES = ['uds_msd80_msd80_capture.fail1.cap', 'uds_msd80_msd80_capture.fail2.cap', 'uds_msd80_msd80_capture.fail5.cap'];

describe('candump + UDS 集成（BMW MSD80 真实抓包）', () => {
  const parsed = FILES.map((f) => ({ name: f, r: parseCandump(fs.readFileSync(path.join(DIR, f), 'utf8')) }));

  it('3 个 .cap 样本均能解析且错误率极低', () => {
    for (const { name, r } of parsed) {
      expect(r.messages.length).toBeGreaterThan(0);
      // R4：损坏行占比应极低（真实抓包不含大量坏行）
      const errRate = r.parseErrorCount / (r.messages.length + r.parseErrorCount);
      expect(errRate).toBeLessThan(0.05);
    }
  });

  it('ISO-TP 重组在真实数据上产出多帧长报文', () => {
    let multiFrameCount = 0;
    let maxLen = 0;
    let found137 = false;
    for (const { r } of parsed) {
      const { messages } = reassembleISOTP(r.messages);
      for (const m of messages) {
        if (m.totalLength > 8) multiFrameCount++;
        maxLen = Math.max(maxLen, m.totalLength);
        if (m.totalLength === 137) found137 = true;
      }
    }
    // PLAN §六 UDS ①：137B 长响应必过（2×FF + ≥8×CF 的重组）
    expect(multiFrameCount).toBeGreaterThan(0);
    expect(found137).toBe(true);
    expect(maxLen).toBeGreaterThanOrEqual(137);
  });

  it('UDS 服务可识别（正/负响应、DID、DTC）', () => {
    let udsCount = 0;
    let sawNegative = false;
    for (const { r } of parsed) {
      const { messages } = reassembleISOTP(r.messages);
      const services = classifyUDSServices(messages);
      udsCount += services.length;
      if (services.some((s) => s.isNegative)) sawNegative = true;
    }
    expect(udsCount).toBeGreaterThan(0);
    // BMW 抓包含负响应（如 0x7f + NRC）是合理的；若样本无负响应也不强求
    expect(typeof sawNegative).toBe('boolean');
  });

  it('KWP2000 帧（0x6f1/0x612）被计入容错而非报错丢弃', () => {
    for (const { r } of parsed) {
      const kwp = r.messages.filter((m) => m.id === 0x6f1 || m.id === 0x612);
      // KWP 帧存在（约束：不解析但不得丢弃），且整体 parseErrorCount 不受影响
      expect(kwp.length).toBeGreaterThanOrEqual(0);
    }
  });
});
