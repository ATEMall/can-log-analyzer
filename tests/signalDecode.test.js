// Unit tests for the signal decode engine — dependency-free (node:assert + node:test optional).
// Run: npm test   (or: node tests/signalDecode.test.js)
const assert = require('node:assert');
const {
  decodeSignalFrame, decodeSignalRawValue, getEnumLabel, decodeSignalsForLog
} = require('../electron/signalDecode');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

console.log('— Motorola (big-endian) —');
// Full 2-byte signal, MSB at byte0 bit7: 0x12,0x34 -> 0x1234 = 4660
check('moto 16-bit 12 34 = 4660',
  decodeSignalFrame([0x12, 0x34], { startBit: 7, length: 16, byteOrder: 'big', signed: false }) === 4660);
// signed all-ones -> -1
check('moto signed16 FF FF = -1',
  decodeSignalFrame([0xFF, 0xFF], { startBit: 7, length: 16, byteOrder: 'big', signed: true }) === -1);

console.log('— cantools motohawk canonical known-answer —');
// BO_ 496 ExampleMessage; frame c0 06 e0 00 00 00 00 00
const fr = [0xc0, 0x06, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00];
const Enable = { startBit: 7, length: 1, byteOrder: 'big', signed: false, scale: 1, offset: 0, valueDefs: { 0: 'Disabled', 1: 'Enabled' } };
const AverageRadius = { startBit: 6, length: 6, byteOrder: 'big', signed: false, scale: 0.1, offset: 0 };
const Temperature = { startBit: 0, length: 12, byteOrder: 'big', signed: true, scale: 0.01, offset: 250 };
check('motohawk Enable raw = 1', decodeSignalRawValue(fr, Enable) === 1);
check('motohawk Enable label = Enabled', getEnumLabel(decodeSignalRawValue(fr, Enable), Enable) === 'Enabled');
check('motohawk AverageRadius = 3.2', approx(decodeSignalFrame(fr, AverageRadius), 3.2));
check('motohawk Temperature = 250.55', approx(decodeSignalFrame(fr, Temperature), 250.55));

console.log('— Intel (little-endian) —');
// byte0=0x90, byte1=0x01 -> little 16-bit = 0x0190 = 400
check('intel 16-bit 90 01 = 400',
  decodeSignalFrame([0x90, 0x01], { startBit: 0, length: 16, byteOrder: 'little', signed: false }) === 400);
// scale/offset
check('intel scale/offset',
  approx(decodeSignalFrame([0x64], { startBit: 0, length: 8, byteOrder: 'little', signed: false, scale: 0.5, offset: 10 }), 60));
// signed negative: 0xFF as 8-bit signed = -1
check('intel signed8 FF = -1',
  decodeSignalFrame([0xFF], { startBit: 0, length: 8, byteOrder: 'little', signed: true }) === -1);

console.log('— >32-bit (BigInt path) —');
// 40-bit little-endian unsigned, all 0xFF -> 2^40-1
check('intel 40-bit all ones',
  decodeSignalFrame([0xFF, 0xFF, 0xFF, 0xFF, 0xFF], { startBit: 0, length: 40, byteOrder: 'little', signed: false }) === 1099511627775);

console.log('— batch decode + mux + enum via decodeSignalsForLog —');
const dbc = [{
  id: 100, name: 'M', dlc: 2, signals: [
    { name: 'Mode', muxIndicator: 'M', startBit: 0, length: 8, byteOrder: 'little', signed: false, scale: 1, offset: 0 },
    { name: 'A', muxIndicator: 'm0', startBit: 8, length: 8, byteOrder: 'little', signed: false, scale: 1, offset: 0 },
    { name: 'B', muxIndicator: 'm1', startBit: 8, length: 8, byteOrder: 'little', signed: false, scale: 1, offset: 0 },
  ]
}];
const frames = [
  { timestamp: 0.0, id: 100, data: [0x00, 0x11] }, // Mode 0 -> A present (0x11), B absent
  { timestamp: 0.1, id: 100, data: [0x01, 0x22] }, // Mode 1 -> B present (0x22), A absent
];
const out = decodeSignalsForLog(frames, dbc, ['100::A', '100::B']);
check('mux frame0 has A only', out.rows[0].A === 0x11 && !('B' in out.rows[0]));
check('mux frame1 has B only', out.rows[1].B === 0x22 && !('A' in out.rows[1]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
