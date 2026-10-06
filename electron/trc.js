// PCAN-View .trc 文本解析器（v4.0 / B3）
//
// 物料 `EIS-1.trc` 为 PCAN-View v4.3 导出的 CAN FD trace，头部为 `;$...` 注释，
// 数据行形如（列由 $COLUMNS 声明，常见为 N,O,T,I,d,l,D）：
//      1        83.901 FB     07A0 Rx 64 FD 00 00 ...
//   N=序号  O=时间(ms)  T=类型(FB/FD 等)  I=CAN ID(hex)  d=方向  l=长度  D=数据(hex)
//
// 归一化为与 ASC/candump 同构的消息：{timestamp(秒), id, data, dlc, isExtended, ...}

'use strict';

const TRC_LINE_RE =
  /^\s*(\d+)\s+([\d.]+)\s+(\S+)\s+([0-9A-Fa-f]+)\s+(Rx|Tx)\s+(\d+)\s+(.*)$/;

function hexBytes(str, len) {
  const toks = String(str || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length && (len == null || out.length < len); i++) {
    const b = parseInt(toks[i], 16);
    if (!Number.isInteger(b) || b < 0 || b > 0xff) break;
    out.push(b);
  }
  return out;
}

/**
 * 解析 PCAN .trc 文本。
 * @param {string} text
 * @returns {{messages:object[],parseErrors:object[],parseErrorCount:number,headerLines:string[],errorFrames:object[]}}
 */
function parseTRC(text) {
  const messages = [];
  const parseErrors = [];
  const headerLines = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let lineNum = 0;
  let statusLines = 0;

  for (const raw of lines) {
    lineNum++;
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      headerLines.push(line);
      continue; // 头部注释，不计错误
    }
    if (messages.length >= 1000000) continue;
    // PCAN 状态行（`ST`）无 CAN ID，属正常记录而非损坏行，单独统计。
    if (/^\d+\s+[\d.]+\s+ST\b/.test(line)) { statusLines++; continue; }

    const m = line.match(TRC_LINE_RE);
    if (!m) {
      parseErrors.push({
        lineNumber: lineNum,
        line: line.slice(0, 200),
        reason: 'trc 数据行格式不识别'
      });
      continue;
    }

    const tMs = parseFloat(m[2]);
    const id = parseInt(m[4], 16);
    const dlc = parseInt(m[6], 10);
    const data = hexBytes(m[7], dlc);
    if (!Number.isFinite(tMs) || !Number.isInteger(id)) {
      parseErrors.push({ lineNumber: lineNum, line: line.slice(0, 200), reason: 'trc 时间戳或 CAN ID 非法' });
      continue;
    }
    messages.push({
      timestamp: Number((tMs / 1000).toFixed(6)), // ms → s
      channel: 1,
      id,
      direction: m[5],
      dlc: data.length,
      data,
      isFd: dlc > 8,
      isExtended: id > 0x7ff,
      source: 'trc'
    });
  }

  return {
    messages,
    parseErrors,
    parseErrorCount: parseErrors.length,
    headerLines,
    statusLines,
    errorFrames: []
  };
}

module.exports = { parseTRC, TRC_LINE_RE };
