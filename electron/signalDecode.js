// =====================================================================
// Signal decode engine — pure module (no electron deps), unit-testable.
//
// R2: the chunked decode protocol splits the frame corpus into blocks and
// yields one chunk of decoded rows at a time so the main process never
// builds the full result in one synchronous pass and the renderer can
// append incrementally (UI stays responsive on 1M-frame logs).
//
// The legacy one-shot path (signal:decodeFrames) uses the same context /
// chunk function for bit-identical results.
// =====================================================================
const { decodeSignalFrame, getEnumLabel } = require('./dbc');

/**
 * Build the decode context once per (dbcMessages, selectedSignals) pair.
 * Returns { dbcMap, signalLookup, signalKeys, encodedCount }.
 * signalLookup: `msgId::signalName` -> { dbcSig, dbcMsg, muxSwitch }
 */
function buildDecodeContext(dbcMessages, selectedSignals) {
  const dbcMap = {};
  for (const msg of dbcMessages) dbcMap[msg.id] = msg;

  const signalLookup = {};
  for (const sel of selectedSignals) {
    const dbcMsg = dbcMap[sel.msgId];
    if (!dbcMsg) continue;
    const dbcSig = dbcMsg.signals.find(s => s.name === sel.signalName);
    if (!dbcSig) continue;
    const key = `${sel.msgId}::${sel.signalName}`;

    // Determine if this signal is multiplexed
    let muxSwitch = null;
    if (dbcSig.muxIndicator) {
      if (dbcSig.muxIndicator === 'M') {
        muxSwitch = { type: 'switch', signal: dbcSig };
      } else if (dbcSig.muxIndicator.startsWith('m')) {
        const muxVal = parseInt(dbcSig.muxIndicator.replace(/^m/, '').replace(/M$/, ''));
        if (!isNaN(muxVal)) {
          const switchSig = dbcMsg.signals.find(s => s.muxIndicator === 'M');
          muxSwitch = { type: 'dependent', switchSig, value: muxVal };
        }
      }
    }
    signalLookup[key] = { dbcSig, dbcMsg, muxSwitch };
  }

  let encodedCount = 0;
  for (const key of Object.keys(signalLookup)) {
    if (signalLookup[key].dbcSig.valueDefs) encodedCount++;
  }

  return { dbcMap, signalLookup, signalKeys: Object.keys(signalLookup), encodedCount };
}

/**
 * Whether a log frame is an extended (29-bit) CAN frame. Falls back to the
 * classic-CAN heuristic (id > 0x7FF) when the parser did not record the flag
 * (e.g. TSMaster-format ASC lines).
 */
function frameIsExtended(frame) {
  if (frame.isExtended !== undefined && frame.isExtended !== null) {
    return !!frame.isExtended;
  }
  return Number(frame.id) > 0x7FF;
}

/**
 * Decode one block of frames.
 * @param {object[]} frames - subset of the loaded log (filtered by caller)
 * @param {object} ctx - result of buildDecodeContext
 * @returns {object} { rows, decodedCount }
 *   rows: [{ t, signals }] — only frames carrying at least one selected signal.
 *   The chunk decoder must not allocate the entire corpus at once; callers
 *   should keep block sizes bounded (default 500k frames).
 */
function decodeFramesChunk(frames, ctx) {
  const { dbcMap, signalLookup } = ctx;
  const rows = [];
  let decodedCount = 0;
  const selectedKeys = Object.keys(signalLookup);

  for (const frame of frames) {
    const dbcMsg = dbcMap[frame.id];
    if (!dbcMsg) continue; // no DBC definition for this message ID

    // R3: extended-frame matching — a frame is only decoded when its extended
    // flag matches the DBC model (BA_ "VFrameFormat" BO_ <id> 1). Mismatched
    // frames are skipped so the UI can mark them "未匹配".
    const dbcExt = !!dbcMsg.isExtended;
    if (frameIsExtended(frame) !== dbcExt) continue;

    const row = { t: frame.timestamp, signals: {} };
    let hasSignal = false;

    // Resolve mux switch value first (if any selected signal requires it)
    let muxSwitchValue = undefined;
    let muxSwitchResolved = false;

    for (const key of selectedKeys) {
      const entry = signalLookup[key];
      if (!entry || entry.dbcMsg.id !== frame.id) continue;

      const { dbcSig, muxSwitch } = entry;

      if (muxSwitch) {
        if (muxSwitch.type === 'switch') {
          const val = decodeSignalFrame(frame.data, dbcSig);
          const label = getEnumLabel(dbcSig, val);
          row.signals[key] = val;
          if (label !== undefined) row.signals[key + '::label'] = label;
          hasSignal = true;
          muxSwitchValue = val;
          muxSwitchResolved = true;
          continue;
        }
        if (muxSwitch.type === 'dependent') {
          if (!muxSwitchResolved && muxSwitch.switchSig) {
            muxSwitchValue = decodeSignalFrame(frame.data, muxSwitch.switchSig);
            muxSwitchResolved = true;
          }
          if (muxSwitchValue !== muxSwitch.value) continue;
        }
      }

      const physical = decodeSignalFrame(frame.data, dbcSig);
      const label = getEnumLabel(dbcSig, physical);
      row.signals[key] = physical;
      if (label !== undefined) row.signals[key + '::label'] = label;
      hasSignal = true;
    }

    if (hasSignal) {
      rows.push(row);
      decodedCount++;
    }
  }

  return { rows, decodedCount };
}

/**
 * Convenience wrapper: decode everything in one call (legacy path / tests).
 */
function decodeAll(loadedMessages, selectedSignals, dbcMessages) {
  const ctx = buildDecodeContext(dbcMessages, selectedSignals);
  const { rows, decodedCount } = decodeFramesChunk(loadedMessages, ctx);
  return {
    signalData: rows,
    stats: {
      totalFrames: loadedMessages.length,
      decodedFrames: decodedCount,
      selectedSignals: selectedSignals.length,
      encodedSignals: ctx.encodedCount,
      signalKeys: ctx.signalKeys.length
    }
  };
}

module.exports = { buildDecodeContext, decodeFramesChunk, decodeAll, frameIsExtended };
