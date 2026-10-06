// candump 文本日志解析器（v4.0 / B1，PLAN-v4.0 §四 坑1 方案①）
//
// 物料 `TestExample/roadmap_v3x/uds_xcp/*.cap` 是 Linux `candump` 文本，三列：
//   <epoch 秒（6 位小数）>  0x<CAN ID>  <数据 HEX>
// 例：1775602023.192750 0x140 0a0a000000000000
//
// 解析为与 ASC 加载器同构的返回：{ headerLines, messages, parseErrors,
// parseErrorCount, errorFrames }，从而可复用 R2 分块管道与现有报文表。
// 时间基准归一化为相对会话起始秒（与报文表 timestamp 字段对齐）。

'use strict';

// 把数据段（可能空格分隔，也可能整段无空格）转为字节数组。
function hexToBytes(dataStr) {
  const trimmed = dataStr.trim();
  if (!trimmed) return [];
  if (/\s/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .map((h) => parseInt(h, 16))
      .filter((b) => Number.isInteger(b) && b >= 0 && b <= 0xff);
  }
  const out = [];
  for (let i = 0; i + 2 <= trimmed.length; i += 2) {
    const b = parseInt(trimmed.slice(i, i + 2), 16);
    if (!Number.isInteger(b) || b < 0 || b > 0xff) return out; // 损坏：停止
    out.push(b);
  }
  return out;
}

// 一帧 candump 行的正则：epoch + 0xID + 可选数据（空格分隔或无空格）。
const CAP_LINE_RE =
  /^(\d+\.?\d*)\s+0x([0-9A-Fa-f]+)(?:\s+([0-9A-Fa-f]+(?:\s+[0-9A-Fa-f]+)*))?\s*$/;

function parseCandumpLine(line, lineNum, parseErrors, startTimeRef) {
  const m = line.match(CAP_LINE_RE);
  if (!m) {
    // 非空但不合规的行（注释 / 杂项）计入容错统计，沿用 R4 原则不中断。
    if (line.trim()) {
      parseErrors.push({
        lineNumber: lineNum,
        line: line.trim().slice(0, 200),
        reason: 'candump 行格式不识别（非 epoch + 0xID + 数据）'
      });
    }
    return null;
  }

  const absTime = parseFloat(m[1]);
  const id = parseInt(m[2], 16);
  if (!Number.isFinite(absTime) || !Number.isInteger(id)) {
    parseErrors.push({
      lineNumber: lineNum,
      line: line.trim().slice(0, 200),
      reason: 'candump 时间戳或 CAN ID 非法'
    });
    return null;
  }

  const data = hexToBytes(m[3] || '');
  if (startTimeRef.t0 === null) startTimeRef.t0 = absTime;

  return {
    timestamp: Number((absTime - startTimeRef.t0).toFixed(6)),
    channel: 1,
    id,
    direction: 'Rx', // candump 被动抓包，无 Tx/Rx 方向
    dlc: data.length,
    data,
    isExtended: id > 0x7ff,
    source: 'candump'
  };
}

/**
 * 解析 candump 文本。
 * @param {string} text 整个文件文本
 * @returns {{headerLines:string[],messages:object[],parseErrors:object[],parseErrorCount:number,errorFrames:object[]}}
 */
function parseCandump(text) {
  const messages = [];
  const parseErrors = [];
  const errorFrames = []; // candump 不含错误帧事件，保持空
  const startTimeRef = { t0: null };

  const lines = String(text == null ? '' : text).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return; // 空行跳过，不计错误
    if (line.startsWith('#')) return; // `#` 注释行跳过，不计错误
    if (messages.length >= 1000000) return; // 上限保护
    const msg = parseCandumpLine(line, idx + 1, parseErrors, startTimeRef);
    if (msg) messages.push(msg);
  });

  return {
    headerLines: [],
    messages,
    parseErrors,
    parseErrorCount: parseErrors.length,
    errorFrames
  };
}

module.exports = { parseCandump, hexToBytes, CAP_LINE_RE };
