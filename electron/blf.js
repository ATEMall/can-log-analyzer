// =====================================================================
// BLF (Vector Binary Logging Format) reader/writer
// Implements the standard Vector BLF layout so files are readable by
// python-can / Vector CANalyzer as well as by this app's own parser.
//
// Supported object types:
//   1   = CAN_MESSAGE          (classic CAN)
//   2   = CAN_MESSAGE2         (classic CAN, alternative layout)
//   10  = LOG_CONTAINER        (container of compressed/uncompressed objects)
//   100 = CAN_FD_MESSAGE       (CAN FD, up to 64 bytes)
//   101 = CAN_FD_MESSAGE_64    (CAN FD, extended header)
//   144 = J1939 / extended CAN (treated as classic CAN, up to 64 bytes)
// =====================================================================
const zlib = require('zlib');

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

// ---------- Build a BLF buffer from messages ----------
// messages: [{ timestamp(s), channel, id(number), direction, dlc, data[], isFd, brs, esi }]
function buildBLFBuffer(messages) {
  const header = Buffer.alloc(144);
  header.write('LOGG', 0, 'ascii');
  header.writeUInt16LE(144, 4);      // header size
  header.writeUInt16LE(1, 6);        // application id
  header.writeUInt16LE(1, 8);        // application major
  header.writeUInt16LE(0, 10);       // application minor
  header.writeUInt16LE(0, 12);       // application build
  header.writeUInt16LE(1, 14);       // binary log major
  header.writeUInt16LE(5, 16);       // binary log minor
  header.writeUInt16LE(1, 18);       // binary log build
  header.writeUInt16LE(1, 20);       // binary log patch

  const objs = [];
  let minT = Infinity;
  let maxT = -Infinity;
  for (const msg of messages) {
    const ts = Number(msg.timestamp) || 0;
    if (ts < minT) minT = ts;
    if (ts > maxT) maxT = ts;

    const data = (msg.data || []).map(Number);
    const len = Math.min(data.length, 64);
    const id = (Number(msg.id) || 0) & 0x1FFFFFFF;
    const isFd = !!msg.isFd || len > 8;

    if (isFd) {
      // CAN_FD_MESSAGE (type 100): 32-byte LOBJ header + 87-byte payload
      // payload layout "<HBBLLBBB5x64s":
      //   channel(H), flags(B), dlc-code(B), arbitration id(L),
      //   frame length(L), bit count(L), fd_flags(B), valid bytes(B),
      //   5 reserved, 64 data bytes
      const obj = Buffer.alloc(119);
      obj.write('LOBJ', 0, 'ascii');
      obj.writeUInt16LE(32, 4);        // header size
      obj.writeUInt16LE(0, 6);         // header version
      obj.writeUInt32LE(119, 8);       // object size
      obj.writeUInt32LE(100, 12);      // object type = CAN_FD_MESSAGE
      obj.writeUInt32LE(0, 16);        // flags
      obj.writeUInt32LE(0, 20);        // object flags
      obj.writeBigUInt64LE(BigInt(Math.max(0, Math.round(ts * 1e9))), 24); // timestamp ns

      obj.writeUInt16LE(msg.channel || 1, 32);                       // channel
      obj.writeUInt8(msg.direction === 'Tx' ? 0x01 : 0x00, 34);      // flags (Tx)
      obj.writeUInt8(len2dlc(len), 35);                              // dlc (code)
      obj.writeUInt32LE(id, 36);                                     // arbitration id
      obj.writeUInt32LE(0, 40);                                      // frame length
      obj.writeUInt32LE(0, 44);                                      // bit count
      const fdFlags = 0x1 | (msg.brs ? 0x2 : 0) | (msg.esi ? 0x4 : 0);
      obj.writeUInt8(fdFlags, 48);                                   // fd_flags (EDL|BRS|ESI)
      obj.writeUInt8(len, 49);                                       // valid bytes
      for (let i = 0; i < len; i++) obj.writeUInt8(data[i], 55 + i); // data (64 bytes region)
      objs.push(obj);
      continue;
    }

    // Classic CAN_MSG (type 1): 32-byte LOBJ header + 16-byte payload
    const obj = Buffer.alloc(48);
    obj.write('LOBJ', 0, 'ascii');
    obj.writeUInt16LE(32, 4);        // header size
    obj.writeUInt16LE(0, 6);         // header version
    obj.writeUInt32LE(48, 8);        // object size
    obj.writeUInt32LE(1, 12);        // object type = CAN_MSG
    obj.writeUInt32LE(0, 16);        // flags
    obj.writeUInt32LE(0, 20);        // object flags
    obj.writeBigUInt64LE(BigInt(Math.max(0, Math.round(ts * 1e9))), 24); // timestamp ns

    obj.writeUInt8(msg.channel || 1, 32);                          // channel
    obj.writeUInt8(msg.direction === 'Tx' ? 0x01 : 0x00, 33);      // flags (Tx)
    const dlc = Math.min(msg.dlc != null ? msg.dlc : (msg.data ? msg.data.length : 0), 8);
    obj.writeUInt8(dlc, 34);                                       // dlc
    obj.writeUInt8(0, 35);                                         // reserved
    // R3: bit 31 of the arbitration id marks an extended (29-bit) CAN frame
    const extId = ((msg.isExtended || id > 0x7FF) ? (id | 0x80000000) : id) >>> 0;
    obj.writeUInt32LE(extId, 36);                                  // arbitration id
    for (let i = 0; i < Math.min(8, data.length); i++) {
      obj.writeUInt8(data[i], 40 + i);                             // data[8]
    }
    objs.push(obj);
  }

  const body = Buffer.concat(objs);
  const fileSize = 144 + body.length;
  header.writeBigUInt64LE(BigInt(fileSize), 22);   // file size
  header.writeBigUInt64LE(BigInt(fileSize), 30);   // uncompressed file size
  header.writeUInt32LE(objs.length, 38);           // count of objects
  header.writeUInt32LE(0, 42);                     // count of compressed objects

  const t0 = Number.isFinite(minT) ? minT : 0;
  const t1 = Number.isFinite(maxT) ? maxT : 0;
  header.writeBigUInt64LE(BigInt(Math.max(0, Math.round(t0 * 1e7))), 46); // measurement start (100ns units)
  header.writeBigUInt64LE(BigInt(Math.max(0, Math.round(t1 * 1e7))), 54); // last object time (100ns units)
  header.writeInt32LE(0, 62);                      // timezone offset (minutes)
  header.writeUInt16LE(0, 66);                     // daylight saving flag

  const now = new Date();
  systemTimeBuf(now).copy(header, 70);             // measurement start SYSTEMTIME
  systemTimeBuf(now).copy(header, 86);             // last object SYSTEMTIME
  header.write('Local', 102, 'ascii');             // timezone name (32 bytes)

  return Buffer.concat([header, body]);
}

function systemTimeBuf(d) {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(d.getFullYear(), 0);
  b.writeUInt16LE(d.getMonth() + 1, 2);
  b.writeUInt16LE(d.getDay(), 4);    // day of week
  b.writeUInt16LE(d.getDate(), 6);
  b.writeUInt16LE(d.getHours(), 8);
  b.writeUInt16LE(d.getMinutes(), 10);
  b.writeUInt16LE(d.getSeconds(), 12);
  b.writeUInt16LE(d.getMilliseconds(), 14);
  return b;
}

// ---------- Parse a BLF buffer into messages ----------
// selectedIds: Set of ids to keep (empty Set = keep all)
const SUPPORTED_TYPES = [1, 2, 100, 101, 144];

// Same as parseBLFBuffer but also returns parse errors (bad blocks are skipped,
// never fatal). Errors are capped at 100 entries plus a total count.
function parseBLFBufferDetailed(buffer, selectedIds) {
  const signature = buffer.toString('ascii', 0, 4);
  if (signature !== 'LOGG') {
    throw new Error('Invalid BLF file: missing LOGG signature');
  }
  const headerSize = buffer.readUInt16LE(4);
  const dataOffset = Math.max(headerSize, 144);
  if (dataOffset >= buffer.length) {
    throw new Error('Invalid BLF file: corrupted header');
  }

  const messages = [];
  const errors = [];
  let errorCount = 0;
  const addError = (offset, reason) => {
    errorCount++;
    if (errors.length < 100) errors.push({ offset, reason });
  };
  const keepAll = !selectedIds || selectedIds.size === 0;

  let searchOff = dataOffset;
  while (searchOff < buffer.length - 4) {
    const b0 = buffer[searchOff];

    // zlib-compressed object block (starts with 0x78)
    if (b0 === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buffer[searchOff + 1])) {
      let decomp;
      try {
        decomp = zlib.inflateSync(buffer.slice(searchOff));
      } catch (e) {
        addError(searchOff, '压缩对象块解压失败: ' + (e.message || e));
        searchOff++;
        continue;
      }
      if (decomp.length < 20) {
        addError(searchOff, '压缩对象块内容过短（<20 字节）');
        searchOff++;
        continue;
      }
      scanObjectStream(decomp, messages, keepAll, selectedIds);
      // skip past the compressed block (conservative estimate)
      searchOff += Math.max(Math.floor(decomp.length / 10), 256);
      continue;
    }

    // uncompressed object block
    if (buffer.toString('ascii', searchOff, searchOff + 4) === 'LOBJ') {
      try {
        const objSize = buffer.readUInt32LE(searchOff + 8);
        const objType = buffer.readUInt32LE(searchOff + 12);
        if (objSize >= 32 && searchOff + objSize <= buffer.length) {
          // LOG_CONTAINER: base header (16B) + container payload header (16B: method, reserved 6, uncompressed size, reserved 4) + objects
          if (objType === 10) {
            const method = buffer.readUInt16LE(searchOff + 16);
            const cData = buffer.slice(searchOff + 32, searchOff + objSize);
            let inner = null;
            try {
              if (method === 0) inner = cData;
              else if (method === 2) inner = zlib.inflateSync(cData);
            } catch (e) { addError(searchOff, 'LOG_CONTAINER 解压失败: ' + (e.message || e)); }
            if (inner && inner.length > 0) {
              scanObjectStream(inner, messages, keepAll, selectedIds);
            } else if (method === 0 || method === 2) {
              addError(searchOff, 'LOG_CONTAINER 内容为空或无效（method=' + method + '）');
            }
            searchOff += objSize;
            continue;
          }
          if (SUPPORTED_TYPES.includes(objType)) {
            const msg = parseObjectAt(buffer, searchOff, keepAll, selectedIds);
            if (msg) messages.push(msg);
            searchOff += objSize;
            if (objSize === 0) searchOff++;
            continue;
          }
        } else {
          addError(searchOff, '对象块大小非法（objSize=' + objSize + '）');
        }
      } catch (e) { addError(searchOff, '对象块解析异常: ' + (e.message || e)); }
    }
    searchOff++;
  }

  // Sort by timestamp (BLF blocks are usually ordered, but be safe)
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return { messages, errors, errorCount };
}

// Backwards-compatible wrapper: returns just the message array.
function parseBLFBuffer(buffer, selectedIds) {
  return parseBLFBufferDetailed(buffer, selectedIds).messages;
}

// Scan a raw object stream (e.g. decompressed container payload) for LOBJ
// objects and parse the supported message types.
function scanObjectStream(decomp, messages, keepAll, selectedIds) {
  let off = 0;
  while (off + 20 <= decomp.length) {
    if (decomp.toString('ascii', off, off + 4) !== 'LOBJ') { off++; continue; }
    let objSize, objType;
    try {
      objSize = decomp.readUInt32LE(off + 8);
      objType = decomp.readUInt32LE(off + 12);
    } catch (e) { off++; continue; }
    if (objSize < 32 || off + objSize > decomp.length) break;
    if (SUPPORTED_TYPES.includes(objType)) {
      const msg = parseObjectAt(decomp, off, keepAll, selectedIds);
      if (msg) messages.push(msg);
    }
    off += objSize;
    if (objSize === 0) off++;
  }
}

// Parse one LOBJ CAN message object at `off`
function parseObjectAt(buf, off, keepAll, selectedIds) {
  try {
    const hdrLen = buf.readUInt16LE(off + 4);
    const objSize = buf.readUInt32LE(off + 8);
    const objType = buf.readUInt32LE(off + 12);
    if (hdrLen < 16 || objSize < hdrLen + 12 || off + objSize > buf.length) return null;

    // Timestamp: LOBJ header @24, uint64 nanoseconds
    let timestamp = 0;
    if (off + 32 <= buf.length) {
      const rawTs = buf.readBigUInt64LE(off + 24);
      timestamp = Number(rawTs) / 1e9;
    }

    const p = off + hdrLen;

    // --- CAN FD (type 100): payload "<HBBLLBBB5x64s", 87 bytes ---
    // Data length is governed by valid_bytes (python-can/CANoe convention);
    // dlc (code -> bytes) is metadata only.
    if (objType === 100) {
      const channel = buf.readUInt16LE(p);
      const flags = buf.readUInt8(p + 2);
      const dlcCode = buf.readUInt8(p + 3);
      const rawId = buf.readUInt32LE(p + 4);
      const id = rawId & 0x1FFFFFFF;
      const fdFlags = buf.readUInt8(p + 16);
      const validBytes = buf.readUInt8(p + 17);
      const byteLen = dlc2len(dlcCode);
      const dataLen = Math.max(0, Math.min(validBytes, 64));
      const data = [];
      for (let i = 0; i < dataLen; i++) data.push(buf.readUInt8(p + 23 + i));
      if (!keepAll && !selectedIds.has(id)) return null;
      return {
        timestamp,
        channel,
        id,
        direction: flags & 0x01 ? 'Tx' : 'Rx',
        dlc: byteLen,
        data,
        isFd: true,
        brs: !!(fdFlags & 0x02),
        esi: !!(fdFlags & 0x04)
      };
    }

    // --- CAN FD 64 (type 101): payload "<BBBBLLLLLLLHBBL" (40B header) + data ---
    // Data length governed by valid_bytes; missing tail is zero-padded to
    // valid_bytes (python-can/CANoe behavior).
    if (objType === 101) {
      const channel = buf.readUInt8(p);
      const dlcCode = buf.readUInt8(p + 1);
      const validBytes = buf.readUInt8(p + 2);
      const rawId = buf.readUInt32LE(p + 4);
      const id = rawId & 0x1FFFFFFF;
      const fdFlags = buf.readUInt32LE(p + 12);
      const directionByte = buf.readUInt8(p + 34);
      const extOff = buf.readUInt8(p + 35);
      const byteLen = dlc2len(dlcCode);
      const dataStart = p + 40;
      // data field may be followed by padding; length limited by valid bytes
      const avail = Math.max(0, (extOff ? off + extOff : off + objSize) - dataStart);
      const dataLen = Math.max(0, Math.min(validBytes, avail));
      const data = [];
      for (let i = 0; i < dataLen; i++) data.push(buf.readUInt8(dataStart + i));
      // zero-pad to valid_bytes (matches CANoe / python-can)
      while (data.length < validBytes) data.push(0);
      if (!keepAll && !selectedIds.has(id)) return null;
      return {
        timestamp,
        channel,
        id,
        direction: directionByte !== 0 ? 'Tx' : 'Rx', // 0=Rx, 1=Tx (python-can convention)
        dlc: byteLen,
        data,
        isFd: true,
        brs: !!(fdFlags & 0x2000),
        esi: !!(fdFlags & 0x4000)
      };
    }

    // --- Classic CAN (types 1, 2, 144) ---
    const channel = buf.readUInt8(p);
    const flags = buf.readUInt8(p + 1);
    let dlc = buf.readUInt8(p + 2);
    const rawId = buf.readUInt32LE(p + 4);
    // R3: bit 31 of the arbitration id marks an extended (29-bit) CAN frame;
    // fall back to the id-range heuristic for files written without the flag.
    const isExtended = (rawId & 0x80000000) !== 0 || rawId > 0x7FF;
    const id = rawId & (rawId > 0x7FF ? 0x1FFFFFFF : 0x7FF);

    if (objType === 144 && dlc > 64) dlc = Math.min(dlc & 0x0F, 8);
    const maxData = objType === 144 ? 64 : 8;
    const dataLen = Math.min(dlc, maxData);
    const data = [];
    for (let i = 0; i < dataLen; i++) {
      data.push(buf.readUInt8(p + 8 + i));
    }

    if (!keepAll && !selectedIds.has(id)) return null;
    return {
      timestamp,
      channel,
      id,
      direction: flags & 0x01 ? 'Tx' : 'Rx',
      dlc,
      data,
      isExtended
    };
  } catch (e) {
    return null;
  }
}

module.exports = { buildBLFBuffer, parseBLFBuffer, parseBLFBufferDetailed, dlc2len, len2dlc };
