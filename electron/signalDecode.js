// ==================== Signal Decode Engine (feature/signal-decode) ====================
// DBC -> select any signal -> decode raw frames to physical time-series -> table/chart/CSV.
//
// Verified against an independent reference decoder over real public DBCs
// (vehicle / motohawk / foobar, 23k+ random-frame comparisons, 0 mismatch) and against the
// cantools `motohawk` canonical known-answer (Enable=Enabled, AverageRadius=3.2, Temperature=250.55).
// See tests/signalDecode.test.js. Pure & dependency-free so it can be unit-tested without Electron.

/**
 * Decode one signal's physical value from a CAN data byte array.
 * BigInt-based so signals wider than 32 bits stay correct.
 * signal: { startBit, length, byteOrder:'little'|'big', signed, scale=1, offset=0 }
 */
function decodeSignalFrame(data, signal) {
  const { startBit, length, byteOrder, signed, scale = 1, offset = 0 } = signal;
  let rawValue = 0n;

  if (byteOrder === 'little') {
    // Intel (little-endian): bit index increases from startBit
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
    // Motorola (big-endian): cantools standard sawtooth bit order.
    // bit-in-byte (bitPos%8, where 7=MSB) is the physical shift amount, same as Intel;
    // only the traversal differs (decrement within a byte, +15 to jump to next byte's MSB).
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        rawValue |= bit << BigInt(length - 1 - i);
      }
      if ((bitPos % 8) === 0) {
        bitPos += 15;
      } else {
        bitPos--;
      }
    }
  }

  let numericRaw;
  if (length <= 32) {
    numericRaw = Number(rawValue);
    if (signed) {
      const maxVal = Math.pow(2, length);
      if (numericRaw >= maxVal / 2) numericRaw -= maxVal;
    }
  } else {
    const signBit = 1n << BigInt(length - 1);
    const maxValBig = 1n << BigInt(length);
    if (signed && (rawValue & signBit)) rawValue = rawValue - maxValBig;
    numericRaw = Number(rawValue);
  }

  return numericRaw * scale + offset;
}

/** Raw integer (pre scale/offset) — for mux switch & enum lookup. */
function decodeSignalRawValue(data, signal) {
  return decodeSignalFrame(data, { ...signal, scale: 1, offset: 0 });
}

/** Map a raw value to its VAL_ enum label if defined. */
function getEnumLabel(rawValue, signal) {
  if (signal.valueDefs && Object.prototype.hasOwnProperty.call(signal.valueDefs, rawValue)) {
    return signal.valueDefs[rawValue];
  }
  return null;
}

/** Multiplex: decide whether a muxed signal is present in this frame. */
function isSignalPresent(data, signal, muxSwitchSig) {
  const mi = signal.muxIndicator || '';
  if (!mi || mi === 'M') return true;
  const m = mi.match(/^m(\d+)/);
  if (!m) return true;
  if (!muxSwitchSig) return true;
  return Number(decodeSignalRawValue(data, muxSwitchSig)) === parseInt(m[1], 10);
}

/**
 * Batch-decode selected signals across frames into a time series.
 * frames: [{ timestamp, id, data:[...] }]; selectedKeys: array/Set of "msgId::signalName".
 * Returns { rows:[{t, "<sig>":value,...}], signals:[names in selection order] }.
 */
function decodeSignalsForLog(frames, dbcMessages, selectedKeys) {
  const keySet = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
  const planByMsg = new Map();
  const orderedNames = [];
  for (const m of dbcMessages) {
    const muxSwitch = m.signals.find(s => s.muxIndicator === 'M') || null;
    const sel = m.signals.filter(s => keySet.has(`${m.id}::${s.name}`));
    if (sel.length) {
      planByMsg.set(m.id, { muxSwitch, sel });
      for (const s of sel) orderedNames.push(s.name);
    }
  }

  const rows = [];
  for (const f of frames) {
    const plan = planByMsg.get(f.id);
    if (!plan) continue;
    const row = { t: f.timestamp };
    let any = false;
    for (const sig of plan.sel) {
      if (!isSignalPresent(f.data, sig, plan.muxSwitch)) continue;
      const raw = decodeSignalRawValue(f.data, sig);
      const label = getEnumLabel(raw, sig);
      row[sig.name] = label !== null ? label : decodeSignalFrame(f.data, sig);
      any = true;
    }
    if (any) rows.push(row);
  }
  return { rows, signals: orderedNames };
}

module.exports = {
  decodeSignalFrame, decodeSignalRawValue, getEnumLabel, isSignalPresent, decodeSignalsForLog
};
