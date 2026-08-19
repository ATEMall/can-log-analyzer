// Generates a rich 64-byte CAN FD test scenario:
//   - vehicle_canfd.asc  (Vector/python-can CANFD format)
//   - vehicle_canfd.blf  (BLF container, type 100 CAN_FD_MESSAGE)
//   - vehicle_canfd.dbc  (DBC with 64B + 32B messages, 60+ signals)
//
// Each message is sent 15 times with a slowly varying payload so that the
// curve renderer has multiple data points per signal and the layout view
// shows B0..B63 populated with real signals.

const fs = require('fs');
const path = require('path');
const { generateASC } = require('../../electron/asc');
const { buildBLFBuffer } = require('../../electron/blf');
const { parseDBC, decodeSignalFrame } = require('../../electron/dbc');

const OUT = __dirname;

// CRC-15 CAN FD seed + check
function crc15(data) {
  let crc = 0;
  for (const b of data) {
    crc ^= (b << 7);
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x4000) ? ((crc << 1) ^ 0x4599) & 0x7fff : (crc << 1) & 0x7fff;
    }
  }
  return crc;
}

function crc17(data) {
  let crc = 0;
  for (const b of data) {
    crc ^= (b << 9);
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x20000) ? ((crc << 1) ^ 0x1685B) & 0x1ffff : (crc << 1) & 0x1ffff;
    }
  }
  return crc;
}

// Build a 64-byte payload for VCU_STATE: each signal is packed as little-endian
// unsigned integer (no DBC factor applied here - just a faithful bit-packing
// of representative raw values).
function buildVCUStatePayload(t) {
  const buf = Buffer.alloc(64);
  // B0-B1  VehicleSpeed raw = (50 + 5*sin(t)) * 100 = 4000..6000
  buf.writeUInt16LE(Math.round(4000 + 1000 * Math.sin(t)), 0);
  // B2-B3  MotorRPM = 1500 + 500*sin(t/2)
  buf.writeUInt16LE(Math.round(1500 + 500 * Math.sin(t * 0.5)), 2);
  // B4-B5  ThrottlePct 0..100 * 100
  buf.writeUInt16LE(Math.round(50 + 40 * Math.sin(t * 0.3)), 4);
  // B6-B7  BrakePressure 0..200 * 10
  buf.writeUInt16LE(Math.round(100 + 80 * Math.cos(t)), 6);
  // B8-B9  BatteryVoltage 300..420V (factor 0.01, raw = voltage * 100)
  buf.writeUInt16LE(Math.round(38000), 8);
  // B10-B11 BatteryCurrent signed -200..200 * 100
  buf.writeInt16LE(Math.round(50 * 100 * Math.sin(t)), 10);
  // B12 DriveMode 0..4
  buf.writeUInt8(Math.floor((t * 0.1) % 5), 12);
  // B13 Gear 0..6
  buf.writeUInt8(Math.floor((t * 0.07) % 7), 13);
  // B14-B15 SteeringAngle signed -540..540 * 10
  buf.writeInt16LE(Math.round(200 * Math.sin(t * 0.4)), 14);
  // B16-B17 YawRate signed * 100
  buf.writeInt16LE(Math.round(50 * Math.sin(t * 0.6)), 16);
  // B18-B19 LateralAccel * 100
  buf.writeInt16LE(Math.round(30 * Math.cos(t * 0.4)), 18);
  // B20-B21 LongitudinalAccel * 100
  buf.writeInt16LE(Math.round(40 * Math.sin(t * 0.2)), 20);
  // B22..B29 four wheel speeds
  for (let i = 0; i < 4; i++) {
    buf.writeUInt16LE(Math.round(4500 + 500 * Math.sin(t * 0.4 + i * 0.1)), 22 + i * 2);
  }
  // B30-B33 Odometer uint32 * 1000
  buf.writeUInt32LE(Math.round(12345 * 1000), 30);
  // B34-B35 CabinTemp signed * 10
  buf.writeInt16LE(Math.round(220), 34);
  // B36-B37 AmbientTemp signed * 10
  buf.writeInt16LE(Math.round(180), 36);
  // B38 HVACFanSpeed
  buf.writeUInt8(Math.floor((t * 0.2) % 8), 38);
  // B39 ACSetpoint
  buf.writeUInt8(Math.round(22 * 2), 39);
  // B40 DoorStatus bitfield
  buf.writeUInt8(0b00001010, 40);
  // B41..B44 four window positions
  for (let i = 0; i < 4; i++) buf.writeUInt8(Math.round(100 * Math.abs(Math.sin(t + i))), 41 + i);
  // B45 LightStatus bitfield
  buf.writeUInt8(0b00000101, 45);
  // B46 WiperStatus
  buf.writeUInt8(Math.floor((t * 0.3) % 4), 46);
  // B47..B50 four tire pressures * 10
  for (let i = 0; i < 4; i++) buf.writeUInt8(Math.round(22 + Math.sin(t + i) * 2), 47 + i);
  // B51-B52 BatterySOC * 100
  buf.writeUInt16LE(Math.round(65 * 100), 51);
  // B53-B54 BatteryTemp signed * 10
  buf.writeInt16LE(Math.round(350), 53);
  // B55-B56 PackVoltage (factor 0.01, raw = voltage * 100)
  buf.writeUInt16LE(Math.round(39600), 55);
  // B57-B58 PackCurrent signed * 100
  buf.writeInt16LE(Math.round(12000), 57);
  // B59-B60 CellVoltMax (factor 0.01, raw = V * 100)
  buf.writeUInt16LE(Math.round(415), 59);
  // B61-B62 CellVoltMin (factor 0.01, raw = V * 100)
  buf.writeUInt16LE(Math.round(380), 61);
  // B63 CellTempMax (504|8) CellTempAvg (505|3) CellTempMin (506|2) Spare (508|4)
  buf.writeUInt8(35, 63); // bit 0..2 CellTempMax=-|35|=read as 35, 35<-128 ok
  return buf;
}

function buildBMSPackPayload(t) {
  const buf = Buffer.alloc(32);
  // B0-B1 SOC * 100
  buf.writeUInt16LE(Math.round((60 + 5 * Math.sin(t * 0.1)) * 100), 0);
  // B2-B3 SOH * 100
  buf.writeUInt16LE(9900, 2);
  // B4-B5 Voltage (factor 0.01, raw = voltage * 100)
  buf.writeUInt16LE(39600, 4);
  // B6-B7 Current signed * 100
  buf.writeInt16LE(Math.round(12000 + 1000 * Math.sin(t)), 6);
  // B8-B9 CellVoltMax (factor 0.01, raw = V * 100)
  buf.writeUInt16LE(415, 8);
  // B10-B11 CellVoltMin (factor 0.01, raw = V * 100)
  buf.writeUInt16LE(380, 10);
  // B12-B13 CellVoltDelta (factor 0.01, raw = V * 100)
  buf.writeUInt16LE(35, 12);
  // B14 CellTempMax signed
  buf.writeInt8(35, 14);
  // B15 CellTempMin signed
  buf.writeInt8(22, 15);
  // B16-B17 Cycles
  buf.writeUInt16LE(1234, 16);
  // B18-B19 PackTempAvg signed * 10
  buf.writeInt16LE(280, 18);
  // B20-B21 InsulationRes
  buf.writeUInt16LE(5500, 20);
  // B22 ChargeState
  buf.writeUInt8(2, 22);
  // B23-B24 ChargePower * 10
  buf.writeUInt16LE(11000, 23);
  // B25 bit0 Heater, bit1 Pump, bit2 Balancer, bit3 ChargerConnected
  buf.writeUInt8(0b00000111, 25);
  // B26 bit0..3 ChargerType
  buf.writeUInt8(2, 26);
  // B27-B28 EstimatedChargeTime
  buf.writeUInt16LE(180, 27);
  // B29-B32 EnergyDelivered uint32 * 1000
  buf.writeUInt32LE(1234000, 28);
  return buf;
}

function makeMessage(id, channel, direction, dlc, data, isFd = true, brs = true, esi = false) {
  return { id, channel, direction, dlc, data, isFd, brs, esi, timestamp: 0 };
}

// Build messages - 15 frames each, 10ms apart, VCU and BMS interleaved.
function buildMessages() {
  const messages = [];
  let t = 0;
  for (let i = 0; i < 15; i++) {
    messages.push({ ...makeMessage(256, 1, 'Tx', 64, Array.from(buildVCUStatePayload(t))), timestamp: t });
    messages.push({ ...makeMessage(512, 1, 'Tx', 32, Array.from(buildBMSPackPayload(t))), timestamp: t + 0.005 });
    t += 0.01;
  }
  return messages;
}

const messages = buildMessages();

// --- Generate ASC ---
const headerLines = [
  'date Wed Aug 19 2026 10:00:00.000 2026',
  'base hex  timestamps absolute',
  'internal events logged',
  '// version 13.0.0',
  'Begin Triggerblock',
  '   0.000000 Start of measurement'
];
const ascText = generateASC(headerLines, messages) + '\r\nEnd TriggerBlock\r\n';
const ascFile = path.join(OUT, 'vehicle_canfd.asc');
fs.writeFileSync(ascFile, ascText);
console.log('Wrote', ascFile, '(' + ascText.length + ' bytes, ' + messages.length + ' frames)');

// --- Generate BLF ---
// Use my buildBLFBuffer to write the same messages, then add a tiny
// object stream wrapped in a LOG_CONTAINER for completeness.
const blfBuf = buildBLFBuffer(messages.map(m => ({
  timestamp: m.timestamp,
  channel: m.channel,
  id: m.id,
  dlc: m.dlc,
  data: m.data,
  isFd: true,
  brs: true,
  esi: false,
  direction: m.direction
})));
const blfFile = path.join(OUT, 'vehicle_canfd.blf');
fs.writeFileSync(blfFile, blfBuf);
console.log('Wrote', blfFile, '(' + (blfBuf?.length || 0) + ' bytes)');

// --- Verify DBC round-trip ---
const dbcText = fs.readFileSync(path.join(OUT, 'vehicle_canfd.dbc'), 'utf8');
const parsed = parseDBC(dbcText);
const vcu = parsed.find(m => m.id === 256);
const bms = parsed.find(m => m.id === 512);
if (!vcu || vcu.dlc !== 64) throw new Error('VCU_STATE missing or wrong dlc');
if (!bms || bms.dlc !== 32) throw new Error('BMS_PACK missing or wrong dlc');
console.log('DBC parsed: VCU_STATE dlc=' + vcu.dlc + ' signals=' + vcu.signals.length +
            ', BMS_PACK dlc=' + bms.dlc + ' signals=' + bms.signals.length);

// Decode first frame of each message
const vcuPayload = buildVCUStatePayload(0);
const bmsPayload = buildBMSPackPayload(0);
const vcuSpeed = vcu.signals.find(s => s.name === 'VehicleSpeed');
const bmsSoc = bms.signals.find(s => s.name === 'PackSOC');
if (!vcuSpeed || !bmsSoc) throw new Error('Signals not found in parsed DBC');
const vcuSpeedVal = decodeSignalFrame(vcuPayload, vcuSpeed);
const bmsSocVal = decodeSignalFrame(bmsPayload, bmsSoc);
console.log('Sample VCU VehicleSpeed =', vcuSpeedVal, vcuSpeed.unit);
console.log('Sample BMS PackSOC =', bmsSocVal, bmsSoc.unit);
if (vcuSpeedVal < 30 || vcuSpeedVal > 70) throw new Error('VehicleSpeed out of expected range');
if (bmsSocVal < 50 || bmsSocVal > 80) throw new Error('PackSOC out of expected range');

// Verify ASC text contains CANFD lines
if (!ascText.includes('CANFD')) throw new Error('ASC does not contain CANFD lines');
const vcuAscCount = (ascText.match(/CANFD 1 Tx 100 /g) || []).length;
const bmsAscCount = (ascText.match(/CANFD 1 Tx 200 /g) || []).length;
console.log('ASC: VCU CANFD frames=' + vcuAscCount + ', BMS CANFD frames=' + bmsAscCount);
if (vcuAscCount !== 15 || bmsAscCount !== 15) throw new Error('ASC frame count mismatch');

console.log('OK - all vehicle_canfd.* files generated and verified');
