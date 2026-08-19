// =====================================================================
// Temporary diagnostic: verify chart data pipeline with real BLF + DBC.
// Replicates the logic in electron/main.js (parseDBC, decodeSignalFrame,
// getEnumLabel) and src/components/SignalChart.jsx (chartData build),
// then reports whether each selected signal has plottable numeric points.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { parseBLFBuffer } = require('../electron/blf');

// ---------- copied from electron/main.js ----------
function parseDBC(content) {
  const messages = [];
  const lines = content.split(/\r?\n/);
  let currentMessage = null;
  const valueDefs = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
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
        byteOrder: sigMatch[5] === '1' ? 'little' : 'big',
        signed: sigMatch[6] === '-',
        scale: parseFloat(sigMatch[7]),
        offset: parseFloat(sigMatch[8]),
        min: parseFloat(sigMatch[9]),
        max: parseFloat(sigMatch[10]),
        unit: sigMatch[11],
        receivers
      });
      continue;
    }
    const valMatch = trimmed.match(/^VAL_\s+(\d+)\s+([\w\-\.]+)\s+(.*)\s*;?/);
    if (valMatch) {
      const msgId = parseInt(valMatch[1]);
      const sigName = valMatch[2];
      const pairs = valMatch[3];
      const key = `${msgId}:${sigName}`;
      const vals = {};
      const pairMatches = [...pairs.matchAll(/(\d+)\s+"([^"]*)"/g)];
      for (const pm of pairMatches) vals[parseInt(pm[1])] = pm[2];
      if (!valueDefs[key]) valueDefs[key] = {};
      Object.assign(valueDefs[key], vals);
    }
  }
  if (currentMessage) messages.push(currentMessage);
  for (const msg of messages) {
    for (const sig of msg.signals) {
      const key = `${msg.id}:${sig.name}`;
      if (valueDefs[key]) sig.valueDefs = valueDefs[key];
    }
  }
  return messages;
}

function decodeSignalFrame(data, signal) {
  const { startBit, length, byteOrder, signed, scale, offset } = signal;
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
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      if (byteIdx < data.length) {
        rawValue |= BigInt((data[byteIdx] >> bitIdx) & 1) << BigInt(length - 1 - i);
      }
      if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;
    }
  }
  let numericRaw;
  if (length <= 32) {
    numericRaw = Number(rawValue);
    if (signed && numericRaw >= Math.pow(2, length) / 2) numericRaw -= Math.pow(2, length);
  } else {
    const signBit = BigInt(1) << BigInt(length - 1);
    const maxValBig = BigInt(1) << BigInt(length);
    if (signed && (rawValue & signBit)) rawValue = rawValue - maxValBig;
    numericRaw = Number(rawValue);
  }
  return numericRaw * scale + offset;
}

function getEnumLabel(signal, physicalValue) {
  if (!signal.valueDefs) return undefined;
  const { scale, offset } = signal;
  let raw;
  if (scale !== 0 && scale !== 1) raw = Math.round((physicalValue - offset) / scale);
  else raw = Math.round(physicalValue - offset);
  return signal.valueDefs[raw] || undefined;
}
// ---------- end copied ----------

function run(name, blfFile, dbcFile) {
  const blf = fs.readFileSync(path.join(__dirname, blfFile));
  const messages = parseBLFBuffer(blf, new Set());
  const dbcContent = fs.readFileSync(path.join(__dirname, dbcFile), 'utf-8');
  const dbcMessages = parseDBC(dbcContent);

  // select ALL signals
  const selectedSignals = [];
  for (const msg of dbcMessages) {
    for (const sig of msg.signals) {
      selectedSignals.push({ key: `${msg.id}::${sig.name}`, msgId: msg.id, signalName: sig.name });
    }
  }

  const dbcMap = {};
  for (const msg of dbcMessages) dbcMap[msg.id] = msg;

  // Replicates electron/main.js decodeFrames (current logic):
  // numeric value at `key` (for chart plotting) + label at `key + '::label'`
  const signalData = [];
  for (const frame of messages) {
    const dbcMsg = dbcMap[frame.id];
    if (!dbcMsg) continue;
    const row = { t: frame.timestamp, signals: {} };
    let hasSignal = false;
    for (const sel of selectedSignals) {
      const key = `${sel.msgId}::${sel.signalName}`;
      const dbcSig = dbcMsg.signals.find(s => s.name === sel.signalName);
      if (!dbcSig) continue;
      const physical = decodeSignalFrame(frame.data, dbcSig);
      const label = getEnumLabel(dbcSig, physical);
      row.signals[key] = physical;
      if (label !== undefined) row.signals[key + '::label'] = label;
      hasSignal = true;
    }
    if (hasSignal) signalData.push(row);
  }

  console.log(`\n===== ${name} =====`);
  console.log(`BLF frames: ${messages.length}, decoded rows: ${signalData.length}`);
  console.log(`Selected signals: ${selectedSignals.length}`);

  // Replicate SignalChart chartData build
  const MAX_POINTS = 5000;
  const step = signalData.length > MAX_POINTS ? Math.ceil(signalData.length / MAX_POINTS) : 1;
  const chartData = [];
  for (let i = 0; i < signalData.length; i += step) {
    const row = signalData[i];
    const point = { t: Number(row.t.toFixed(4)) };
    for (const sig of selectedSignals) {
      const val = row.signals && row.signals[sig.key];
      if (val !== null && val !== undefined && typeof val === 'number') {
        point[sig.key] = val;
      }
    }
    chartData.push(point);
  }

  let anyNumeric = false;
  for (const sig of selectedSignals) {
    let cnt = 0, min = Infinity, max = -Infinity, sampleTypes = new Set();
    // Count contiguous segments of non-null points: >1 segment means the
    // curve would be broken into pieces (dots) with connectNulls=false.
    let segments = 0, inSeg = false;
    for (const p of chartData) {
      const v = p[sig.key];
      const has = typeof v === 'number';
      if (has) {
        cnt++;
        sampleTypes.add(typeof v);
        if (typeof v === 'number') { min = Math.min(min, v); max = Math.max(max, v); }
        if (!inSeg) { segments++; inSeg = true; }
      } else {
        inSeg = false;
      }
    }
    if (cnt > 0) anyNumeric = true;
    const isEnum = dbcMessages.some(m => m.id === sig.msgId && m.signals.some(s => s.name === sig.signalName && s.valueDefs));
    console.log(
      `${sig.key.padEnd(32)} points=${String(cnt).padEnd(5)} segs=${String(segments).padEnd(3)} types=[${[...sampleTypes].join(',')}]` +
      (cnt > 0 ? ` range=[${min.toFixed(2)}, ${max.toFixed(2)}]` : '  <-- NO DATA') +
      (isEnum ? '  (enum)' : '')
    );
  }
  console.log(`Plottable numeric curves: ${selectedSignals.filter(s => chartData.some(p => typeof p[s.key] === 'number')).length} / ${selectedSignals.length}`);
  return anyNumeric;
}

let ok = true;
ok = run('body_chassis', 'body_chassis.blf', 'body_chassis.dbc') && ok;
ok = run('powertrain', 'powertrain.blf', 'powertrain.dbc') && ok;
process.exit(ok ? 0 : 1);
