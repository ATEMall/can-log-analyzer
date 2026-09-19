// =====================================================================
// ASC (Vector ASCII Logging) parser/writer - pure module (no electron deps)
// Supports classic CAN and CAN FD (up to 64 bytes) in the common formats:
//   Vector / python-can:   CANFD <channel> <Tx|Rx> <id[x]> [frame_name] <brs> <esi> <dlc(hex)> <data_len> <data hex...>
//   TSMaster style:        CANFD <id> <Tx|Rx> <dlc> <data hex...>
//   Vector classic CAN:    <channel> <id> <Tx|Rx> d <dlc> <data hex...>
// =====================================================================

// Header line patterns (always non-data)
const HEADER_PATTERNS = [
  /^date\s/, /^base\s+/, /^timestamps\s/, /^internal\s/,
  /^\/\//, /^Start\s+of\s+measurement/, /^Begin\s*:/,
];

// CAN FD DLC code <-> byte length (ISO 11898-1 / Vector convention)
const FD_DLC_TO_LEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
function dlc2len(code) {
  return (code >= 0 && code < 16) ? FD_DLC_TO_LEN[code] : code;
}
function len2dlc(len) {
  if (len <= 8) return len;
  if (len <= 12) return 9;
  if (len <= 16) return 10;
  if (len <= 20) return 11;
  if (len <= 24) return 12;
  if (len <= 32) return 13;
  if (len <= 48) return 14;
  return 15;
}

// Check if a line is a pure event/log line (NOT a CAN/LIN data frame)
function isNonDataLine(line) {
  const t = line.trim();
  if (!t || t.length < 15) return true;

  // Standard header patterns
  for (const p of HEADER_PATTERNS) {
    if (p.test(t)) return true;
  }

  // SV: lines are TSMaster signal variable updates, never CAN frames
  if (/^\d[\d.]*\s+SV:/.test(t)) return true;

  // Li/CAN/CANFD followed by an alphabetic name = event (not data frame)
  const liEventMatch = t.match(/^\d[\d.]*\s+(?:Li|CAN|CANFD)\s+[A-Za-z_]/);
  if (liEventMatch) return true;

  // Start of measurement marker
  if (/Start of measurement/.test(t) && !/Tx|Rx/.test(t)) return true;

  return false;
}

/**
 * Parse a single ASC data line - supports multiple formats
 */
function parseASCDataLine(line) {
  let trimmed = line.trim();

  // Must start with a timestamp
  const tsMatch = trimmed.match(/^([\d.]+)\s+(.*)$/);
  if (!tsMatch) return null;

  const timestamp = parseFloat(tsMatch[1]);
  const rest = tsMatch[2];
  if (rest.length < 5) return null;

  // --- Strategy 1: Vector standard format (classic CAN) ---
  // R3: id may carry the extended-frame suffix (e.g. "800x"), matching the
  // Vector/CANoe convention for 29-bit CAN ids.
  const vectorMatch = rest.match(/^(\d+)\s+([0-9A-Fa-f]+x?)\s+(Tx|Rx)\s+[dr]\s+(\d+)\s+([0-9A-Fa-f][0-9A-Fa-f](?:\s+[0-9A-Fa-f][0-9A-Fa-f])*)\s*/);
  if (vectorMatch) {
    const dataStr = vectorMatch[5].trim();
    const data = dataStr.split(/\s+/).map(b => parseInt(b, 16));
    const idStr = vectorMatch[2];
    const isExtended = /x$/i.test(idStr);
    return {
      timestamp,
      channel: parseInt(vectorMatch[1]),
      id: parseInt(idStr.replace(/x$/i, ''), 16),
      direction: vectorMatch[3],
      dlc: parseInt(vectorMatch[4]),
      data,
      isExtended
    };
  }

  // --- Strategy 1.5: Vector / python-can CAN FD format ---
  // CANFD <channel> <Tx|Rx> <id[x]> [frame_name] <brs> <esi> <dlc(hex)> <data_length> <data hex...>
  // Guarded so it never steals TSMaster-style lines (CANFD <id> <Tx|Rx> <dlc> <data>):
  // after the optional frame name there must be 0/1, 0/1, hex-dlc, decimal-length.
  if (/^CANFD\s/i.test(rest)) {
    const toks = rest.split(/\s+/).filter(Boolean);
    if (toks.length >= 9 && /^(Tx|Rx)$/i.test(toks[2])) {
      let idx = 4;
      // Optional symbolic frame name: present if next token is not a number
      if (!/^\d+$/.test(toks[idx])) idx++;
      if (
        /^[01]$/.test(toks[idx]) &&          // brs
        /^[01]$/.test(toks[idx + 1]) &&      // esi
        /^[0-9A-Fa-f]$/.test(toks[idx + 2]) && // dlc (hex DLC code)
        /^\d+$/.test(toks[idx + 3])          // data length (decimal bytes)
      ) {
        const idStr = toks[3];
        const isExtended = /x$/i.test(idStr);
        const id = parseInt(idStr.replace(/x$/i, ''), 16);
        const dlcCode = parseInt(toks[idx + 2], 16);
        const dataLen = parseInt(toks[idx + 3], 10);
        const data = toks
          .slice(idx + 4)
          .filter(t => /^[0-9A-Fa-f]{2}$/.test(t))
          .map(b => parseInt(b, 16))
          .slice(0, dataLen);
        if (Number.isFinite(id) && dataLen >= 1 && data.length >= 1) {
          return {
            timestamp,
            channel: parseInt(toks[1], 10) || 1,
            id,
            direction: toks[2].toUpperCase(),
            dlc: dataLen,          // byte length (CAN FD)
            data,
            isFd: true,
            brs: toks[idx] === '1',
            esi: toks[idx + 1] === '1',
            isExtended
          };
        }
      }
    }
  }

  // --- Strategy 2: TSMaster format (CAN / CANFD / LIN) ---
  const tsMasterMatch = rest.match(/^(CAN|CANFD|Li)\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d+)\s+((?:[0-9A-Fa-f]{2}\s+)+)/i);
  if (tsMasterMatch) {
    const busType = tsMasterMatch[1].toUpperCase();
    const dataStr = tsMasterMatch[5].trim();
    const data = dataStr.split(/\s+/).filter(Boolean).map(b => parseInt(b, 16));
    const dlc = Math.min(parseInt(tsMasterMatch[4]), data.length);
    const chMap = { 'CAN': 1, 'CANFD': 1, 'Li': 2 };
    return {
      timestamp,
      channel: chMap[busType] || 1,
      id: parseInt(tsMasterMatch[2], 16),
      direction: tsMasterMatch[3],
      dlc,
      data: data.slice(0, dlc),
      isFd: busType === 'CANFD'
    };
  }

  // --- Strategy 3: Flexible fallback ---
  const flexMatch = rest.match(/^\S+\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d{1,2})\s+((?:[0-9A-Fa-f]{2}\s*)+)/i);
  if (flexMatch && !isNonDataLine(rest)) {
    const dataStr = flexMatch[4].trim();
    const rawData = dataStr.split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/i.test(b)).map(b => parseInt(b, 16));
    if (rawData.length >= 1) {
      const dlc = Math.min(parseInt(flexMatch[3]), rawData.length);
      return {
        timestamp,
        channel: 1,
        id: parseInt(flexMatch[1], 16),
        direction: flexMatch[2],
        dlc,
        data: rawData.slice(0, dlc)
      };
    }
  }

  return null;
}

// R12 (v2.2) — error frames / bus-state event lines (never data frames).
//   Vector classic:  0.123456 1 ErrorFrame
//   Vector / CANoe:  0.123456 CAN ErrorFrame / 0.123456 CAN Bus Off
//   Chip state:      0.123456 Chip State: busoff
//   CANoe event:     0.123456 CAN 1 Status:chip status error passive
const ERROR_FRAME_RE =
  /^(\d+(?:\.\d+)?)\s+(?:(?:CAN|CANFD|Li)\s+)?(?:(\d+)\s+)?(?:[0-9A-Fa-f]+x?\s+)?(Error\s?Frame|Overload\s?Frame)\b(.*)$/i;
const BUS_STATE_RE =
  /^(\d+(?:\.\d+)?)\s+(?:(?:CAN|CANFD|Li)\s+)?(?:(\d+)\s+)?(?:Chip\s*State\s*:?\s*|Status\s*:\s*chip\s*status\s*)?(Bus\s*Off|Error\s*Passive|Error\s*Active|Warning\s*Level)\b(.*)$/i;

// R12-fix (#21): Vector statistic rows are written by CANoe/CANalyzer
// (periodically and at the end of a measurement) and carry the error counters
// the log itself declares:
//   1.000000 1  Statistic: D 12 R 0 XD 1 XR 0 E 5 O 0 BusLoad 8.2 %
//   D = data frames, R = remote, XD/XR = FD variants, E = error frames,
//   O = overload frames, BusLoad = bus load in percent.
const STATISTIC_RE =
  /^(\d+(?:\.\d+)?)\s+(?:(?:CAN|CANFD|Li)\s+)?(?:(\d+)\s+)?Statistic\s*:\s*(.*)$/i;

// Vector ErrorFrame detail fields (classic CAN, SJA1000 ECC style):
//   ErrorFrame Flags = 0x0001 CodeExt = 0x0000 Code = 0x0002 ID = 0x0 DLC = 0 ...
const ERROR_FIELD_RE = /\b(Code|CodeExt|Flags|ID|DLC|Position|Length)\s*=\s*(0[xX][0-9A-Fa-f]+|\d+)/gi;
const ERROR_FIELD_KEYS = {
  code: 'code', codeext: 'codeExt', flags: 'flags',
  id: 'id', dlc: 'dlc', position: 'position', length: 'length'
};

// Error-code table for Vector `Code` bits 0-5 (and `CodeExt` bits 6-11):
//   0 Bit Error | 1 Form Error | 2 Stuff Error | 3 Other | 4 CRC Error
//   5 Ack-Del Error | 6 reserved | 7 Ack Error
const VECTOR_ERROR_CODES = ['bit', 'form', 'stuff', 'other', 'crc', 'ack', 'other', 'ack'];

function decodeVectorErrorCode(value) {
  if (!Number.isFinite(value)) return 'other';
  return VECTOR_ERROR_CODES[(value | 0) & 0x3f] || 'other';
}

/** Parse "Flags = 0x0001 Code = 0x0002 ..." into { flags, code, codeExt, ... }. */
function parseErrorFields(text) {
  const fields = {};
  const s = String(text || '');
  if (!s) return fields;
  ERROR_FIELD_RE.lastIndex = 0;
  let m;
  while ((m = ERROR_FIELD_RE.exec(s)) !== null) {
    const key = ERROR_FIELD_KEYS[m[1].toLowerCase()];
    const raw = m[2];
    const val = /^0[xX]/.test(raw) ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
    if (key && Number.isFinite(val)) fields[key] = val;
  }
  return fields;
}

/** #21: derive the error category from the Vector Code / CodeExt fields. */
function classifyErrorFields(fields) {
  if (!fields) return null;
  if (fields.code !== undefined) return decodeVectorErrorCode(fields.code);
  if (fields.codeExt !== undefined) return decodeVectorErrorCode((fields.codeExt >> 6) & 0x3f);
  return null;
}

/**
 * #21: parse the body of a "Statistic:" row into counters + bus load.
 * Vector writes cumulative counters, so the last row of a measurement is the
 * session total; callers aggregate accordingly.
 */
function parseStatisticBody(text) {
  const counts = { d: 0, r: 0, xd: 0, xr: 0, errorCount: 0, overloadCount: 0 };
  let busLoad = null;
  const s = String(text || '');
  const re = /\b(D|R|XD|XR|E|O|BusLoad)\s+(-?\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const key = m[1].toLowerCase();
    const val = parseFloat(m[2]);
    if (!Number.isFinite(val)) continue;
    if (key === 'busload') { busLoad = val; continue; }
    if (key === 'e') counts.errorCount = val;
    else if (key === 'o') counts.overloadCount = val;
    else counts[key] = val;
  }
  return { counts, busLoad };
}

// Error-frame sub-classification. The trailing human-readable text
// (Vector writes e.g. "ErrorFrame  Stuff Error" / "ErrorFrame  Form Error")
// wins; when the row carries no text but the Vector Flags/Code fields, the
// code bits are decoded instead.
function classifyErrorCategory(text, isOverload, fields) {
  if (isOverload) return 'overload';
  const s = String(text || '');
  if (/stuff/i.test(s)) return 'stuff';
  if (/form/i.test(s)) return 'form';
  if (/ack/i.test(s)) return 'ack';
  if (/crc/i.test(s)) return 'crc';
  if (/bit\s*1/i.test(s)) return 'bit1';
  if (/bit\s*0/i.test(s)) return 'bit0';
  return classifyErrorFields(fields) || 'other';
}

/**
 * #21: cheap pre-filter used by the ASC reader before the data-frame parser.
 * Shared with the main process so the "is this an event row?" decision has a
 * single definition (a row that declares a chip status carries no payload and
 * must never be counted as an unparsable data line).
 */
function isErrorEventCandidate(line) {
  const s = String(line == null ? '' : line).toLowerCase();
  return s.includes('error')        // ErrorFrame / Error Passive / Error Active
    || s.includes('bus')            // Bus Off / BusLoad
    || s.includes('overload')       // OverloadFrame
    || s.includes('statistic')      // Statistic: ... rows (#21)
    || s.includes('status')         // Status:chip status <state> (#21)
    || s.includes('warning');       // Warning Level (#21)
}

/**
 * R12: parse an ASC error-frame / bus-state / statistic event line.
 * Returns null for anything that is not such an event, so callers can probe
 * cheaply before falling back to the data-frame parser.
 */
function parseASCErrorLine(line) {
  const t = String(line == null ? '' : line).trim();
  if (!t) return null;

  // #21: statistic rows first — they carry the counters the log declares.
  const stat = t.match(STATISTIC_RE);
  if (stat) {
    const body = (stat[3] || '').trim();
    const { counts, busLoad } = parseStatisticBody(body);
    return {
      timestamp: parseFloat(stat[1]),
      channel: stat[2] !== undefined ? parseInt(stat[2], 10) : 1,
      kind: 'statistic',
      counts,
      errorCount: counts.errorCount,
      overloadCount: counts.overloadCount,
      busLoad,
      text: body || 'Statistic'
    };
  }

  const err = t.match(ERROR_FRAME_RE);
  if (err) {
    const isOverload = /^overload/i.test(err[3]);
    const rest = (err[4] || '').trim();
    const fields = parseErrorFields(rest);
    const ev = {
      timestamp: parseFloat(err[1]),
      channel: err[2] !== undefined ? parseInt(err[2], 10) : 1,
      kind: 'error-frame',
      category: classifyErrorCategory(rest, isOverload, fields),
      text: rest || err[3]
    };
    // Detail fields are optional: only surface what the row actually carried.
    for (const key of ['flags', 'code', 'codeExt', 'id', 'dlc', 'position', 'length']) {
      if (fields[key] !== undefined) ev[key] = fields[key];
    }
    return ev;
  }

  const st = t.match(BUS_STATE_RE);
  if (st) {
    const token = st[3].toLowerCase();
    const state = /passive/.test(token) ? 'error-passive'
      : (/off/.test(token) ? 'bus-off'
        : (/warn/.test(token) ? 'warning' : 'error-active'));
    return {
      timestamp: parseFloat(st[1]),
      channel: st[2] !== undefined ? parseInt(st[2], 10) : 1,
      kind: 'bus-state',
      state,
      text: (st[4] || '').trim() || st[3]
    };
  }

  return null;
}

/**
 * Re-serialize messages back into ASC text.
 * CAN FD messages are written in the Vector/python-can CANFD line format so
 * the output round-trips through parseASCDataLine and stays readable by
 * python-can / Vector tools.
 */
function generateASC(headerLines, messages) {
  const output = [...headerLines, ''];
  for (const msg of messages) {
    const dataStr = msg.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    if (msg.isFd) {
      const idHex = (Number(msg.id) || 0).toString(16).toUpperCase();
      const ext = msg.isExtended || (Number(msg.id) || 0) > 0x7FF ? 'x' : '';
      const dlcCode = len2dlc((msg.data || []).length).toString(16);
      output.push(
        `${msg.timestamp.toFixed(6)} CANFD ${msg.channel || 1} ${msg.direction || 'Rx'} ${idHex}${ext} ${msg.brs ? 1 : 0} ${msg.esi ? 1 : 0} ${dlcCode} ${(msg.data || []).length} ${dataStr}`
      );
    } else {
      // R3: write the extended-frame suffix "x" so 29-bit CAN ids round-trip.
      const ext = (msg.isExtended || (Number(msg.id) || 0) > 0x7FF) ? 'x' : '';
      output.push(`${msg.timestamp.toFixed(6)} ${msg.channel || 1} ${(Number(msg.id) || 0).toString(16).toUpperCase()}${ext} ${msg.direction || 'Rx'} d ${msg.dlc || (msg.data || []).length} ${dataStr}`);
    }
  }
  return output.join('\r\n');
}

module.exports = {
  HEADER_PATTERNS,
  isNonDataLine,
  parseASCDataLine,
  parseASCErrorLine,
  isErrorEventCandidate,
  classifyErrorCategory,
  classifyErrorFields,
  parseErrorFields,
  parseStatisticBody,
  decodeVectorErrorCode,
  generateASC,
  dlc2len,
  len2dlc
};
