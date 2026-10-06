// ISO-TP（ISO 15765-2）多帧重组（v4.0 / B1-T1，PLAN-v4.0 §三 T1）
//
// 按 CAN ID 独立重组（请求/响应配对是 B2-T4 的事）：
//   - 单帧 SF   : PCI 高 4 位 = 0，低 4 位 = 长度
//   - 首帧 FF   : PCI = 0x1n，长度 = ((n & 0x0f) << 8) | data[1]
//   - 连续帧 CF : PCI = 0x2n，n 为序号（0..15 回绕）；首帧后第一个 CF 序号必为 1
//   - 流控帧 FC : PCI = 0x3n（0 CTS / 1 Wait / 2 Abort），仅记录不计入数据
//
// 约束（PLAN §三 T1）：
//   - 走主进程流式管道，渲染进程不持有逐帧数据（这里只输出重组后的 payload）
//   - 连续帧间隔 > 1s 判重组中断，已重组部分进 incomplete 列表（禁止静默丢弃）
//   - 重组结果带元数据：来源 CAN ID、首帧时间、总长度、重组耗时

'use strict';

const SF = 0x00;
const FF = 0x10;
const CF = 0x20;
const FC = 0x30;

const DEFAULT_TIMEOUT_S = 1.0; // 连续帧间隔 > 1s 判中断

function toBuf(arr) {
  return Buffer.isBuffer(arr) ? arr : Buffer.from(arr || []);
}

/**
 * 重组一组帧（按 CAN ID 独立）。
 * @param {Array<{id:number,timestamp:number,data:number[]|Buffer}>} frames
 * @param {{timeoutS?:number}} [opts]
 * @returns {{messages:object[],incomplete:object[]}}
 *   messages: { canId, time, payload:Buffer, totalLength, reassembleMs }
 *   incomplete: { canId, time, reason, partialLength? }（容错/中断记录）
 */
function reassembleISOTP(frames, opts) {
  const timeoutS = opts && typeof opts.timeoutS === 'number' ? opts.timeoutS : DEFAULT_TIMEOUT_S;
  const messages = [];
  const incomplete = [];
  /** @type {Map<number, {totalLen:number,buf:Buffer,nextSeq:number,lastTime:number,startTime:number}>} */
  const state = new Map();

  for (const f of frames || []) {
    const data = toBuf(f.data);
    if (data.length === 0) continue;
    const pci = data[0];
    const type = pci & 0xf0;

    if (type === SF) {
      const len = pci & 0x0f;
      const payload = data.slice(1, 1 + len);
      messages.push({
        canId: f.id,
        time: f.timestamp,
        payload,
        totalLength: payload.length,
        reassembleMs: 0
      });
      state.delete(f.id);
      continue;
    }

    if (type === FF) {
      const totalLen = ((pci & 0x0f) << 8) | data[1];
      state.set(f.id, {
        totalLen,
        buf: data.slice(2),
        nextSeq: 1,
        lastTime: f.timestamp,
        startTime: f.timestamp
      });
      continue;
    }

    if (type === CF) {
      let st = state.get(f.id);
      const seq = pci & 0x0f;

      // 连续帧间隔超时 → 之前的重组中断，记录为容错，丢弃已重组部分。
      if (st && typeof f.timestamp === 'number' && typeof st.lastTime === 'number') {
        if (f.timestamp - st.lastTime > timeoutS) {
          incomplete.push({
            canId: f.id,
            time: st.lastTime,
            reason: 'reassembly timeout (> ' + timeoutS + 's between consecutive frames)',
            partialLength: st.buf.length
          });
          state.delete(f.id);
          st = undefined;
        }
      }

      if (!st) {
        incomplete.push({ canId: f.id, time: f.timestamp, reason: 'consecutive frame without first frame' });
        continue;
      }

      if (seq !== (st.nextSeq & 0x0f)) {
        incomplete.push({
          canId: f.id,
          time: f.timestamp,
          reason: 'consecutive frame sequence mismatch (expected ' + (st.nextSeq & 0x0f) + ', got ' + seq + ')',
          partialLength: st.buf.length
        });
        state.delete(f.id);
        continue;
      }

      st.buf = Buffer.concat([st.buf, data.slice(1)]);
      st.nextSeq = (st.nextSeq + 1) & 0xff;
      st.lastTime = f.timestamp;

      if (st.buf.length >= st.totalLen) {
        const payload = st.buf.slice(0, st.totalLen);
        messages.push({
          canId: f.id,
          time: f.timestamp,
          payload,
          totalLength: st.totalLen,
          reassembleMs:
            typeof st.startTime === 'number' && typeof f.timestamp === 'number'
              ? Number(((f.timestamp - st.startTime) * 1000).toFixed(3))
              : 0
        });
        state.delete(f.id);
      }
      continue;
    }

    if (type === FC) {
      // 流控帧：仅记录（不计入数据）。保留在该 ID 的状态不受影响。
      continue;
    }

    // 其他 PCI（诊断/直连等）：不属 ISO-TP，跳过。
  }

  // 文件结束时仍有未完成的重组 → 记容错。
  for (const [id, st] of state) {
    incomplete.push({
      canId: id,
      time: st.lastTime,
      reason: 'incomplete at end of stream',
      partialLength: st.buf.length
    });
  }

  return { messages, incomplete };
}

module.exports = { reassembleISOTP, SF, FF, CF, FC, DEFAULT_TIMEOUT_S };
