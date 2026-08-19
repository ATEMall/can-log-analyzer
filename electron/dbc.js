// =====================================================================
// DBC (CAN database) parser and signal decoder - pure module (no electron deps)
// =====================================================================

/**
 * Parse a DBC file content into message definitions.
 * Handles standard BO_/SG_/VAL_ lines. Data length is not limited to 8 bytes,
 * so CAN FD frames with up to 64 payload bytes decode correctly.
 */
function parseDBC(content) {
  const messages = [];
  const lines = content.split(/\r?\n/);
  let currentMessage = null;
  // Also collect value definitions (VAL_) for enum-type signals
  const valueDefs = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // BO_ - Message definition
    const msgMatch = trimmed.match(/^BO_\s+(\d+)\s+([\w\-\.]+)\s*:\s*(\d+)\s+([\w\-\.]+)/);
    if (msgMatch) {
      if (currentMessage) messages.push(currentMessage);
      currentMessage = {
        id: parseInt(msgMatch[1]),
        name: msgMatch[2],
        dlc: parseInt(msgMatch[3]),
        sender: msgMatch[4],
        signals: []
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
      const msgId = parseInt(valMatch[1]);
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
    }
  }

  if (currentMessage) messages.push(currentMessage);

  // Attach value definitions to signals
  for (const msg of messages) {
    for (const sig of msg.signals) {
      const key = `${msg.id}:${sig.name}`;
      if (valueDefs[key]) {
        sig.valueDefs = valueDefs[key];
      }
    }
  }

  return messages;
}

/**
 * Decode a single signal from CAN data bytes (works for any data length,
 * including CAN FD 64-byte payloads).
 * @param {number[]} data - raw payload bytes
 * @param {object} signal - { startBit, length, byteOrder, signed, scale, offset }
 * @returns {number} physical value
 */
function decodeSignalFrame(data, signal) {
  const { startBit, length, byteOrder, signed, scale, offset } = signal;

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
    // Motorola: MSB-first numbering, sawtooth pattern across bytes
    // Reference: cantools bit numbering (SAE J1939 style)
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);  // MSB = bit 7
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        // MSB of signal goes to highest bit position in rawValue
        rawValue |= bit << BigInt(length - 1 - i);
      }
      // Motorola sawtooth: when we hit bit 0 of a byte, jump to next byte's bit 7
      if ((bitPos % 8) === 0) {
        bitPos += 15;
      } else {
        bitPos--;
      }
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
