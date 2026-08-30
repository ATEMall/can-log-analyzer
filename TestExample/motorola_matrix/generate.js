// Generates the Motorola (big-endian) regression sample:
//   - motorola_matrix.asc  (Vector classic CAN format)
//   - motorola_matrix.blf  (BLF container, type 100 CAN_FD_MESSAGE)
//   - motorola_matrix.dbc  (20 Motorola + 3 Intel signals, see file header)
//
// Every frame uses the fixed payload 12 34 56 78 9A BC DE F0 so the expected
// decoded values are deterministic and are asserted here. This closes the
// v2.0.0 test blind spot: all previous samples were Intel-only.
//
// Usage: node generate.js

const fs = require('fs');
const path = require('path');
const { generateASC } = require('../../electron/asc');
const { buildBLFBuffer } = require('../../electron/blf');
const { parseDBC, decodeSignalFrame, getEnumLabel } = require('../../electron/dbc');

const OUT = __dirname;
const DATA = [0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0];

function makeMessage(id, t, direction = 'Rx') {
  return {
    id, channel: 1, direction, dlc: DATA.length, data: DATA,
    isFd: false, brs: false, esi: false, timestamp: t
  };
}

// One message per ID, ids 512..516, 10 frames each, 10ms apart
function buildMessages() {
  const messages = [];
  const ids = [512, 513, 514, 515, 516];
  let t = 0;
  for (let i = 0; i < 10; i++) {
    for (const id of ids) messages.push(makeMessage(id, t));
    t += 0.01;
  }
  return messages;
}

// Expected physical values for the fixed payload 12 34 56 78 9A BC DE F0.
// Reference semantics (cantools / DBC big-endian):
//   - Motorola: startBit is the signal MSB; bits read in increasing bit order,
//     byte n MSB has bit number 8n.
const EXPECTED = {
  512: { M_MotA: 0x1234, M_MotB: 0x5678, M_MotC: 0x9ABC, M_MotD: 0xDEF0 },
  513: {
    M_MotU8a: 0x12, M_MotU12: 0x345, M_MotU4a: 6, M_MotU4b: 7, M_MotU2: 2,
    M_MotBit1: 1, M_MotBit0: 0, M_MotS8: 0xBC - 0x100, M_MotU16u: 0xDEF0
  },
  514: {
    M_MotU32: 0x12345678, M_MotS16: 0x9ABC - 0x10000, M_MotS8b: 0xDE - 0x100,
    M_MotU8c: 0xF0
  },
  515: {
    M_MotScaled: 0x1234 * 0.1 - 40, M_MotEnum: 0x56,
    M_MotU40: 0x789ABCDEF0
  },
  516: {
    M_IntU16: 0x3412, M_IntS16: 0x7856, M_IntU32: 0xF0DEBC9A
  }
};

const messages = buildMessages();

// --- Generate ASC ---
const headerLines = [
  'date Fri Aug 29 2026 09:00:00.000 2026',
  'base hex  timestamps absolute',
  'internal events logged',
  '// version 13.0.0',
  'Begin Triggerblock',
  '   0.000000 Start of measurement'
];
const ascText = generateASC(headerLines, messages) + '\r\nEnd TriggerBlock\r\n';
const ascFile = path.join(OUT, 'motorola_matrix.asc');
fs.writeFileSync(ascFile, ascText);
console.log('Wrote', ascFile, '(' + ascText.length + ' bytes, ' + messages.length + ' frames)');

// --- Generate BLF ---
const blfBuf = buildBLFBuffer(messages.map(m => ({
  timestamp: m.timestamp, channel: m.channel, id: m.id, dlc: m.dlc,
  data: m.data, isFd: false, brs: false, esi: false, direction: m.direction
})));
const blfFile = path.join(OUT, 'motorola_matrix.blf');
fs.writeFileSync(blfFile, blfBuf);
console.log('Wrote', blfFile, '(' + (blfBuf?.length || 0) + ' bytes)');

// --- Verify DBC parsing + decoding against the reference expectations ---
const dbcText = fs.readFileSync(path.join(OUT, 'motorola_matrix.dbc'), 'utf8');
const parsed = parseDBC(dbcText);
let failures = 0;
for (const msg of parsed) {
  if (!EXPECTED[msg.id]) continue;
  for (const sig of msg.signals) {
    const got = decodeSignalFrame(DATA, sig);
    const want = EXPECTED[msg.id][sig.name];
    const ok = Object.is(got, want);
    if (!ok) failures++;
    const enumLabel = getEnumLabel(sig, got);
    console.log(
      (ok ? 'OK  ' : 'FAIL') + ` ${msg.id} ${sig.name.padEnd(11)} ` +
      `${sig.startBit}|${sig.length}@${sig.byteOrder === 'big' ? '0' : '1'}${sig.signed ? '-' : '+'}` +
      ` -> got ${got}${enumLabel ? ' (' + enumLabel + ')' : ''}, want ${want}`
    );
  }
}
if (failures > 0) {
  console.error(`\n${failures} signal(s) mismatch — decoding is NOT cantools-aligned.`);
  process.exit(1);
}

// Verify ASC round-trip
const { isNonDataLine, parseASCDataLine } = require('../../electron/asc');
let parsedFrames = 0;
for (const line of ascText.split(/\r?\n/)) {
  if (isNonDataLine(line)) continue;
  const m = parseASCDataLine(line);
  if (m) parsedFrames++;
}
if (parsedFrames !== messages.length) {
  console.error(`ASC round-trip failed: parsed ${parsedFrames} != ${messages.length}`);
  process.exit(1);
}

console.log(`\nOK — ${messages.length} frames written; all ${Object.keys(EXPECTED).length} messages verified against reference expectations.`);
