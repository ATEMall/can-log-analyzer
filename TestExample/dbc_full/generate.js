// Generates the R3 "DBC full-feature" regression sample:
//   - dbc_full.asc   (Vector classic CAN + CAN FD lines, incl. extended-id suffix)
//   - dbc_full.blf   (BLF container with classic CAN + CAN FD objects)
//   - dbc_full.dbc   (BA_ attributes / extended frame / mux / SIG_VALTYPE_)
//
// The DBC exercises every R3 capability:
//   - BA_ "GenMsgCycleTime"/"GenMsgSendType"/"GenSigStartValue"
//   - BA_ "VFrameFormat" BO_ 2048 1  -> 29-bit extended frame
//   - SG_ MuxSel M + SG_ Sig* m<n>   -> multiplex decode
//   - SIG_VALTYPE_ 1/2               -> float32 / float64 IEEE754 decode
//
// Usage: node generate.js

const fs = require('fs');
const path = require('path');
const { generateASC } = require('../../electron/asc');
const { buildBLFBuffer } = require('../../electron/blf');
const { parseDBC, decodeSignalFrame, getEnumLabel } = require('../../electron/dbc');
const { decodeAll } = require('../../electron/signalDecode');

const OUT = __dirname;

// Frames with the exact expected physical values per signal.
//  - id 2048 (ExtMuxMsg, extended): mux selector 0 -> SigSpeed+SigRpm, 1 -> SigTemp
//  - id 512  (FloatMsg, CAN FD 12B): F32a=pi (little), F64a=-2.5 (Motorola big)
//  - id 1024 (AttrMsg): StartVal=7, EnumSig=1 ("On"), CycleSig=0x0102
const FRAMES = [
  {
    id: 2048, isExtended: true, dlc: 8,
    data: [0x00, 0x34, 0x12, 0x64, 0x05, 0, 0, 0], t: 0,
    expected: { MuxSel: 0, SigSpeed: 0x1234, SigRpm: 0x0564 }
  },
  {
    id: 2048, isExtended: true, dlc: 8,
    data: [0x01, 0x1E, 0x00, 0, 0, 0, 0, 0], t: 0.01,
    expected: { MuxSel: 1, SigTemp: 30 }
  },
  {
    id: 512, isFd: true, dlc: 12,
    data: [0xDB, 0x0F, 0x49, 0x40, 0xC0, 0x04, 0, 0, 0, 0, 0, 0], t: 0.02,
    expected: { F32a: 3.1415927, F64a: -2.5 }
  },
  {
    id: 1024, dlc: 8,
    data: [0x07, 0x01, 0x02, 0x01, 0, 0, 0, 0], t: 0.03,
    expected: { StartVal: 7, EnumSig: 1, CycleSig: 0x0102 }
  }
];

function log(msg) { console.log(msg); }

// ---------- Read & parse DBC ----------
const dbcText = fs.readFileSync(path.join(OUT, 'dbc_full.dbc'), 'utf8');
const msgs = parseDBC(dbcText);
const msgMap = {};
for (const m of msgs) msgMap[m.id] = m;

log(`Parsed ${msgs.length} messages:`);
for (const m of msgs) {
  log(`  BO_ ${m.id} ${m.name} (dlc=${m.dlc})` +
    (m.isExtended ? ' [Ext]' : '') +
    (m.cycleTime !== undefined ? ` cycle=${m.cycleTime}ms` : '') +
    (m.sendType !== undefined ? ` sendType=${m.sendType}` : ''));
}

// ---------- Verify per-signal decoding against reference expectations ----------
let failures = 0;
for (const f of FRAMES) {
  const msg = msgMap[f.id];
  if (!msg) { log(`FAIL message ${f.id} not in DBC`); failures++; continue; }
  for (const [sigName, want] of Object.entries(f.expected)) {
    const sig = msg.signals.find(s => s.name === sigName);
    const got = decodeSignalFrame(f.data, sig);
    const label = getEnumLabel(sig, got);
    const ok = Math.abs(got - want) < 1e-6;
    if (!ok) failures++;
    log(
      (ok ? 'OK  ' : 'FAIL') + ` ${f.id} ${sigName.padEnd(9)} ` +
      `${sig.startBit}|${sig.length}@${sig.byteOrder === 'big' ? '0' : '1'}` +
      (sig.valueType ? ` (${sig.valueType})` : '') +
      ` -> got ${got}${label ? ' (' + label + ')' : ''}, want ${want}`
    );
  }
}

// ---------- Verify mux semantics + extended-frame matching via the engine ----------
const selection = [
  { msgId: 2048, signalName: 'MuxSel' },
  { msgId: 2048, signalName: 'SigSpeed' },
  { msgId: 2048, signalName: 'SigRpm' },
  { msgId: 2048, signalName: 'SigTemp' },
  { msgId: 512, signalName: 'F32a' },
  { msgId: 512, signalName: 'F64a' },
  { msgId: 1024, signalName: 'StartVal' },
  { msgId: 1024, signalName: 'EnumSig' },
  { msgId: 1024, signalName: 'CycleSig' }
];
const logFrames = FRAMES.map(f => ({
  timestamp: f.t, id: f.id, isExtended: f.isExtended, dlc: f.dlc, data: f.data, direction: 'Rx'
}));
const { signalData, stats } = decodeAll(logFrames, selection, msgs);
const mux0 = signalData.find(r => r.t === 0);
const mux1 = signalData.find(r => r.t === 0.01);
if (mux0 && mux0.signals['2048::SigTemp'] === undefined && mux0.signals['2048::SigSpeed'] === 0x1234) {
  log('OK  2048 mux=0 -> SigSpeed present, SigTemp absent');
} else { log('FAIL 2048 mux=0 branch selection'); failures++; }
if (mux1 && mux1.signals['2048::SigSpeed'] === undefined && mux1.signals['2048::SigTemp'] === 30) {
  log('OK  2048 mux=1 -> SigTemp present, SigSpeed absent');
} else { log('FAIL 2048 mux=1 branch selection'); failures++; }
if (stats.decodedFrames === 4) log(`OK  engine decoded ${stats.decodedFrames}/${stats.totalFrames} frames`);
else { log(`FAIL engine decoded ${stats.decodedFrames}/${stats.totalFrames}`); failures++; }

// Format mismatch: a standard (non-extended) frame for id 2048 must be skipped
const stdFrame = { timestamp: 9, id: 2048, isExtended: false, dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], direction: 'Rx' };
const mm = decodeAll([stdFrame], selection, msgs);
if (mm.stats.decodedFrames === 0) log('OK  extended/std format mismatch -> frame skipped');
else { log('FAIL format mismatch not detected'); failures++; }

// ---------- Generate ASC ----------
const headerLines = [
  'date Fri Aug 29 2026 09:00:00.000 2026',
  'base hex  timestamps absolute',
  'internal events logged',
  '// version 13.0.0',
  'Begin Triggerblock',
  '   0.000000 Start of measurement'
];
const ascMsgs = FRAMES.map(f => ({
  ...f, timestamp: f.t, channel: 1, direction: 'Rx', brs: false, esi: false
}));
const ascText = generateASC(headerLines, ascMsgs) + '\r\nEnd TriggerBlock\r\n';
const ascFile = path.join(OUT, 'dbc_full.asc');
fs.writeFileSync(ascFile, ascText);
log('Wrote', ascFile, '(' + ascText.length + ' bytes, ' + ascMsgs.length + ' frames)');

// ---------- Generate BLF ----------
const blfBuf = buildBLFBuffer(ascMsgs);
const blfFile = path.join(OUT, 'dbc_full.blf');
fs.writeFileSync(blfFile, blfBuf);
log('Wrote', blfFile, '(' + (blfBuf?.length || 0) + ' bytes)');

// ---------- ASC round-trip ----------
const { isNonDataLine, parseASCDataLine } = require('../../electron/asc');
let parsedFrames = 0;
let extFrames = 0;
for (const line of ascText.split(/\r?\n/)) {
  if (isNonDataLine(line)) continue;
  const m = parseASCDataLine(line);
  if (m) {
    parsedFrames++;
    if (m.isExtended) extFrames++;
  }
}
if (parsedFrames !== FRAMES.length) {
  log(`ASC round-trip failed: parsed ${parsedFrames} != ${FRAMES.length}`);
  process.exit(1);
}
if (extFrames !== FRAMES.filter(f => f.isExtended).length) {
  log(`ASC extended-flag round-trip failed: ${extFrames} ext frames`);
  process.exit(1);
}
log(`OK  ASC round-trip: ${parsedFrames} frames (${extFrames} extended)`);

// ---------- BLF round-trip ----------
const { parseBLFBuffer } = require('../../electron/blf');
const blfMsgs = parseBLFBuffer(blfBuf, new Set());
if (blfMsgs.length !== FRAMES.length) {
  log(`BLF round-trip failed: parsed ${blfMsgs.length} != ${FRAMES.length}`);
  process.exit(1);
}
const blfExt = blfMsgs.filter(m => m.isExtended).length;
if (blfExt !== FRAMES.filter(f => f.isExtended).length) {
  log(`BLF extended-flag round-trip failed: ${blfExt} ext frames`);
  process.exit(1);
}
log(`OK  BLF round-trip: ${blfMsgs.length} frames (${blfExt} extended)`);

if (failures > 0) {
  log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
log('\nOK — R3 DBC full sample verified (attributes / extended frame / mux / float).');
