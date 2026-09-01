// =====================================================================
// DBC (CAN database) parser and signal decoder - pure module (no electron deps)
//
// R3 additions:
//   - BA_DEF_ / BA_DEF_DEF_ / BA_ attribute definitions & assignments
//     (GenMsgCycleTime / GenMsgSendType / VFrameFormat / GenSigStartValue)
//   - Extended-frame modeling: canonical 0x80000000 BO_ id flag (takes
//     precedence) + BA_ "VFrameFormat" BO_ <id> 1 as supplementary path
//   - SIG_VALTYPE_ float32 / float64 signal typing + IEEE754 decoding
//
// #7 rework (PM Issue #7): canonical extended-frame flag bit.
//   BO_ <rawId> where rawId >= 0x80000000 declares a 29-bit extended frame;
//   the stored id is normalized to rawId & 0x1FFFFFFF (cantools frame_id).
//   BA_DEF_DEF_ defaults are applied to messages/signals that carry no
//   explicit BA_ assignment (e.g. "VFrameFormat" 0 => standard frame).
// =====================================================================

/** Parse a BA_/BA_DEF_DEF_/BA_ attribute value: boolean / number / string. */
function parseAttrValue(s) {
  const str = String(s).trim();
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str) && Number.isFinite(Number(str))) {
    return Number(str);
  }
  // DBC string literals are double-quoted, e.g. BA_ "GenMsgSendType" BO_ 1 "Cyclic";
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Parse a DBC file content into message definitions.
 * Handles BO_/SG_/VAL_/BA_DEF_/BA_DEF_DEF_/BA_/SIG_VALTYPE_ lines.
 * Data length is not limited to 8 bytes, so CAN FD frames with up to 64
 * payload bytes decode correctly.
 */
function parseDBC(content) {
  const messages = [];
  const lines = content.split(/\r?\n/);
  let currentMessage = null;
  // Value definitions (VAL_) for enum-type signals
  const valueDefs = {};
  // R3: attribute assignments (BA_) by target
  const msgAttrs = {};   // msgId -> { attrName: value }
  const sigAttrs = {};   // "msgId:sigName" -> { attrName: value }
  // R3: SIG_VALTYPE_ float typing
  const sigValueTypes = {}; // "msgId:sigName" -> 'float32' | 'float64'
  // #7: BA_DEF_DEF_ attribute default values (cantools db.attributes)
  const attrDefaults = {}; // attrName -> default value

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // BO_ - Message definition
    // #7: rawId >= 0x80000000 is the canonical DBC encoding of a 29-bit
    // extended frame; the stored id is normalized (frame_id & 0x1FFFFFFF)
    // exactly like cantools does.
    const msgMatch = trimmed.match(/^BO_\s+(\d+)\s+([\w\-\.]+)\s*:\s*(\d+)\s+([\w\-\.]+)/);
    if (msgMatch) {
      if (currentMessage) messages.push(currentMessage);
      let rawId = parseInt(msgMatch[1]);
      const isExtFlag = rawId >= 0x80000000;
      if (isExtFlag) rawId &= 0x1FFFFFFF;
      currentMessage = {
        id: rawId,
        name: msgMatch[2],
        dlc: parseInt(msgMatch[3]),
        sender: msgMatch[4],
        signals: [],
        ...(isExtFlag ? { isExtended: true } : {})
      };
      continue;
    }

    // SG_ - Signal definition (standard + multiplex mux indicators)
    // Format: SG_ <name> [M|m<n>|m<n>M] : <startBit>|<length>@<byteOrder><valueType> (<scale>,<offset>) [<min>|<max>] "<unit>" <receivers>
    const sigMatch = trimmed.match(
      /^SG_\s+([\w\-\.]+)\s*(M|m\d+M?|)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\((-?[\d.eE+\-]+),(-?[\d.eE+\-]+)\)\s*\[(-?[\d.eE+\-]+)\|(-?[\d.eE+\-]+)\]\s*"([^"]*)"\s*(.*)/
    );
    if (sigMatch && currentMessage) {
      const receivers = sigMatch[12]
        ? sigMatch[12].trim().split(/\s*,\s*/).filter(r => r && r !== 'Vector__XXX')
        : [];
      currentMessage.signals.push({
        name: sigMatch[1],
        muxIndicator: sigMatch[2] ? sigMatch[2].trim() : '',
        startBit: parseInt(sigMatch[3]),
        length: parseInt(sigMatch[4]),
        byteOrder: sigMatch[5] === '1' ? 'little' : 'big',  // 1=Intel(little-endian), 0=Motorola(big-endian)
        signed: sigMatch[6] === '-',
        scale: parseFloat(sigMatch[7]),
        offset: parseFloat(sigMatch[8]),
        min: parseFloat(sigMatch[9]),
        max: parseFloat(sigMatch[10]),
        unit: sigMatch[11],
        receivers: receivers
      });
      continue;
    }

    // VAL_ - Value definitions (for enum signals)
    // Format: VAL_ <msgId> <sigName> <value> "<label>" ... ;
    const valMatch = trimmed.match(/^VAL_\s+(\d+)\s+([\w\-\.]+)\s+(.*)\s*;?/);
    if (valMatch) {
      // Normalize the extended-frame flag bit on the msgId (#7).
      const msgId = parseInt(valMatch[1]) & 0x1FFFFFFF;
      const sigName = valMatch[2];
      const pairs = valMatch[3];
      const key = `${msgId}:${sigName}`;
      const vals = {};
      const pairMatches = [...pairs.matchAll(/(\d+)\s+"([^"]*)"/g)];
      for (const pm of pairMatches) {
        vals[parseInt(pm[1])] = pm[2];
      }
      if (!valueDefs[key]) valueDefs[key] = {};
      Object.assign(valueDefs[key], vals);
      continue;
    }

    // R3: BA_DEF_ - attribute definition
    // Format: BA_DEF_ <target> "<name>" <dataType> [<min>|<max>];
    const baDefMatch = trimmed.match(/^BA_DEF_\s+(BO_|SG_|BU_)\s+"([^"]+)"\s+(\w+)(?:\s+([\w\-\.]+)\s+([\w\-\.]+))?\s*;?$/);
    if (baDefMatch) {
      // Attribute definitions are metadata only; assignments drive the model.
      continue;
    }

    // R3: BA_DEF_DEF_ - attribute default value
    // Format: BA_DEF_DEF_ "<name>" <default>;
    // Note: lazy capture keeps a trailing ';' out of the value.
    const baDefDefMatch = trimmed.match(/^BA_DEF_DEF_\s+"([^"]+)"\s+(.+?)\s*;?$/);
    if (baDefDefMatch) {
      // #7: record the default; applied below to objects without a BA_ assignment.
      attrDefaults[baDefDefMatch[1]] = parseAttrValue(baDefDefMatch[2]);
      continue;
    }

    // R3: BA_ - attribute assignment
    // Format: BA_ "<name>" { BO_ <id> | SG_ <id> <sigName> | BU_ <node> } <value>;
    const baMatch = trimmed.match(
      /^BA_\s+"([^"]+)"\s+(?:BO_\s+(\d+)|SG_\s+(\d+)\s+([\w\-\.]+)|BU_\s+([\w\-\.]+))\s+(.+?)\s*;?$/
    );
    if (baMatch) {
      const attrName = baMatch[1];
      const value = parseAttrValue(baMatch[6]);
      if (baMatch[2] !== undefined) {
        // BO_ <id> — normalize the extended-frame flag bit (#7)
        const msgId = parseInt(baMatch[2]) & 0x1FFFFFFF;
        if (!msgAttrs[msgId]) msgAttrs[msgId] = {};
        msgAttrs[msgId][attrName] = value;
      } else if (baMatch[3] !== undefined) {
        // SG_ <id> <sigName> — normalize the extended-frame flag bit (#7)
        const msgId = parseInt(baMatch[3]) & 0x1FFFFFFF;
        const sigName = baMatch[4];
        const key = `${msgId}:${sigName}`;
        if (!sigAttrs[key]) sigAttrs[key] = {};
        sigAttrs[key][attrName] = value;
      }
      // BU_ assignments are not modeled (node attributes out of scope for R3).
      continue;
    }

    // R3: SIG_VALTYPE_ - signal value type (float)
    // Format: SIG_VALTYPE_ <msgId> <sigName> : <1|2>;
    const valtypeMatch = trimmed.match(/^SIG_VALTYPE_\s+(\d+)\s+([\w\-\.]+)\s*:\s*([12])\s*;?$/);
    if (valtypeMatch) {
      // Normalize the extended-frame flag bit on the msgId (#7).
      const msgId = parseInt(valtypeMatch[1]) & 0x1FFFFFFF;
      const sigName = valtypeMatch[2];
      sigValueTypes[`${msgId}:${sigName}`] = valtypeMatch[3] === '1' ? 'float32' : 'float64';
      continue;
    }
  }

  if (currentMessage) messages.push(currentMessage);

  // Attach value definitions, float typing and attributes to signals/messages
  for (const msg of messages) {
    const attrs = msgAttrs[msg.id];
    if (attrs) {
      if (attrs.GenMsgCycleTime !== undefined) msg.cycleTime = attrs.GenMsgCycleTime;
      if (attrs.GenMsgSendType !== undefined) msg.sendType = attrs.GenMsgSendType;
      if (attrs.VFrameFormat !== undefined) msg.frameFormat = attrs.VFrameFormat;
    }
    // #7: canonical 0x80000000 BO_ flag wins; VFrameFormat (explicit BA_ or
    // BA_DEF_DEF_ default) is the supplementary path.
    if (msg.isExtended === undefined) {
      const ff = attrs && attrs.VFrameFormat !== undefined ? attrs.VFrameFormat : attrDefaults.VFrameFormat;
      if (ff === 1 || ff === true || ff === '1') msg.isExtended = true;
      else if (ff === 0 || ff === false || ff === '0') msg.isExtended = false;
    }
    // BA_DEF_DEF_ defaults fill attributes that lack an explicit BA_ assignment.
    if (msg.frameFormat === undefined && attrDefaults.VFrameFormat !== undefined) {
      msg.frameFormat = attrDefaults.VFrameFormat;
    }
    if (msg.cycleTime === undefined && attrDefaults.GenMsgCycleTime !== undefined) {
      msg.cycleTime = attrDefaults.GenMsgCycleTime;
    }
    if (msg.sendType === undefined && attrDefaults.GenMsgSendType !== undefined) {
      msg.sendType = attrDefaults.GenMsgSendType;
    }
    for (const sig of msg.signals) {
      const key = `${msg.id}:${sig.name}`;
      if (valueDefs[key]) sig.valueDefs = valueDefs[key];
      if (sigValueTypes[key]) sig.valueType = sigValueTypes[key];
      const sigAttr = sigAttrs[key];
      if (sigAttr && sigAttr.GenSigStartValue !== undefined) {
        sig.genSigStartValue = sigAttr.GenSigStartValue;
      } else if (sig.genSigStartValue === undefined && attrDefaults.GenSigStartValue !== undefined) {
        sig.genSigStartValue = attrDefaults.GenSigStartValue;
      }
    }
  }

  return messages;
}

/**
 * Decode a single signal from CAN data bytes (works for any data length,
 * including CAN FD 64-byte payloads).
 * @param {number[]} data - raw payload bytes
 * @param {object} signal - { startBit, length, byteOrder, signed, scale, offset, valueType? }
 * @returns {number} physical value
 */
function decodeSignalFrame(data, signal) {
  const { startBit, length, byteOrder, signed, scale, offset, valueType } = signal;

  // R3: IEEE754 float signals (SIG_VALTYPE_ 1=float32, 2=float64).
  // Bit-extract exactly like an integer signal, then reinterpret the bit
  // pattern as a float — the same algorithm cantools uses:
  //   bit-extract -> struct.pack(<I|Q, raw) -> struct.unpack(<f|d).
  if (valueType === 'float32' || valueType === 'float64') {
    const nbytes = valueType === 'float32' ? 4 : 8;
    let rawValue = BigInt(0);
    if (byteOrder === 'little') {
      let bitPos = startBit;
      for (let i = 0; i < length; i++) {
        const byteIdx = Math.floor(bitPos / 8);
        const bitIdx = bitPos % 8;
        if (byteIdx < data.length) {
          rawValue |= BigInt((data[byteIdx] >> bitIdx) & 1) << BigInt(i);
        }
        bitPos++;
      }
    } else {
      // Motorola (big-endian): DBC (Vector) bit numbering — byte n's MSB is
      // bit number 8n+7, its LSB is 8n. startBit points at the signal MSB;
      // walk bits with the classic sawtooth order (MSB->LSB within a byte,
      // +15 jump at byte boundaries). Same semantics as the integer path.
      let bitPos = startBit;
      for (let i = 0; i < length; i++) {
        const byteIdx = Math.floor(bitPos / 8);
        const bitIdx = bitPos % 8;
        if (byteIdx < data.length) {
          rawValue |= BigInt((data[byteIdx] >> bitIdx) & 1) << BigInt(length - 1 - i);
        }
        if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;
      }
    }
    const buf = Buffer.alloc(nbytes);
    if (nbytes === 4) {
      if (byteOrder === 'little') buf.writeUInt32LE(Number(rawValue) >>> 0, 0);
      else buf.writeUInt32BE(Number(rawValue) >>> 0, 0);
      const f = byteOrder === 'little' ? buf.readFloatLE(0) : buf.readFloatBE(0);
      return f * scale + offset;
    }
    if (byteOrder === 'little') buf.writeBigUInt64LE(rawValue, 0);
    else buf.writeBigUInt64BE(rawValue, 0);
    const d = byteOrder === 'little' ? buf.readDoubleLE(0) : buf.readDoubleBE(0);
    return d * scale + offset;
  }

  // Use BigInt for safe >32-bit extraction
  let rawValue = BigInt(0);

  if (byteOrder === 'little') {
    // Intel: linear bit numbering, LSB first within byte
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        rawValue |= bit << BigInt(i);
      }
      bitPos++;
    }
  } else {
    // Motorola (big-endian): DBC (Vector) bit numbering — byte n's MSB is bit
    // number 8n+7, its LSB is 8n. A Motorola signal's startBit is the position
    // of its MSB, so byte-aligned signals start at 7/15/23/31/... (NOT 0).
    // Walk bits in the classic sawtooth order: MSB->LSB within a byte
    // (bitPos % 8 counts down 7..0), then jump +15 to the next byte's MSB.
    // Verified 286/286 vs cantools 43.0.2 (PM Issue #1 acceptance).
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        // First read bit is the signal MSB -> highest rawValue bit
        rawValue |= bit << BigInt(length - 1 - i);
      }
      if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;
    }
  }

  // Handle signed values (>32-bit safe)
  // For signed: if the sign bit (MSB) is set, negate using two's complement
  let numericRaw;
  if (length <= 32) {
    numericRaw = Number(rawValue);
    if (signed) {
      const maxVal = Math.pow(2, length);
      if (numericRaw >= maxVal / 2) {
        numericRaw -= maxVal;
      }
    }
  } else {
    // >32-bit: keep as BigInt for signed handling
    const signBit = BigInt(1) << BigInt(length - 1);
    const maxValBig = BigInt(1) << BigInt(length);
    if (signed && (rawValue & signBit)) {
      rawValue = rawValue - maxValBig;
    }
    numericRaw = Number(rawValue);
  }

  return numericRaw * scale + offset;
}

/**
 * Get VAL_ enum label for a decoded physical value
 */
function getEnumLabel(signal, physicalValue) {
  // R3: float signals (SIG_VALTYPE_) never carry enum labels
  if (signal.valueType) return undefined;
  if (!signal.valueDefs) return undefined;
  // Physical value = raw * scale + offset
  // Enum lookup is on raw value, so reverse: raw = (physical - offset) / scale
  const { scale, offset } = signal;
  let raw;
  if (scale !== 0 && scale !== 1) {
    raw = Math.round((physicalValue - offset) / scale);
  } else {
    raw = Math.round(physicalValue - offset);
  }
  return signal.valueDefs[raw] || undefined;
}

module.exports = { parseDBC, decodeSignalFrame, getEnumLabel };
