// CAN FD (64-byte) support tests:
//  - ASC parsing (Vector/python-can CANFD line format)
//  - BLF fallback parsing of a real CAN FD 64-byte file (LOG_CONTAINER + type 101)
//  - ASC -> BLF -> parse round-trip
//  - generateASC round-trip
//  - DBC parsing + signal decoding on 64-byte payloads
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBLFBuffer, buildBLFBuffer } from '../blf.js';
import { parseASCDataLine, isNonDataLine, generateASC } from '../asc.js';
import { parseDBC, decodeSignalFrame } from '../dbc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(__dirname, '..', '..', 'TestExample', 'canfd');

function readLines(file) {
  return fs.readFileSync(path.join(base, file), 'utf8').split(/\r?\n/);
}

function parseASCFile(file) {
  const msgs = [];
  for (const line of readLines(file)) {
    if (isNonDataLine(line)) continue;
    const m = parseASCDataLine(line);
    if (m) msgs.push(m);
  }
  return msgs;
}

describe('CAN FD ASC parsing (Vector/python-can format)', () => {
  it('parses 64-byte CAN FD frames from the real python-can test file', () => {
    const msgs = parseASCFile('test_CanFdMessage64.asc');
    expect(msgs.length).toBe(2);

    const m0 = msgs[0];
    expect(m0.id).toBe(0x4EE);            // 1262
    expect(m0.direction).toBe('RX');
    expect(m0.dlc).toBe(64);
    expect(m0.data.length).toBe(64);
    expect(m0.isFd).toBe(true);
    expect(m0.brs).toBe(false);
    expect(m0.esi).toBe(true);
    expect(m0.data[0]).toBe(0xA1);
    expect(m0.data[1]).toBe(0x02);
    expect(m0.data[3]).toBe(0x04);
    expect(m0.data[63]).toBe(0x64);

    const m1 = msgs[1];
    expect(m1.id).toBe(0x1C4D80A7);       // extended 29-bit id
    expect(m1.isExtended).toBe(true);
    expect(m1.dlc).toBe(64);
    expect(m1.data.length).toBe(64);
    expect(m1.data[0]).toBe(0xB1);
    expect(m1.data[63]).toBe(0x64);
    expect(m1.brs).toBe(true);
    expect(m1.esi).toBe(false);
  });

  it('parses 8-byte CAN FD frames including one with a frame name', () => {
    const msgs = parseASCFile('test_CanFdMessage.asc');
    expect(msgs.length).toBe(3);

    expect(msgs[0].id).toBe(0x300);
    expect(msgs[0].data).toEqual([0x11, 0xc2, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    expect(msgs[0].brs).toBe(true);
    expect(msgs[0].esi).toBe(false);

    expect(msgs[1].id).toBe(0x1C4D80A7);
    expect(msgs[1].direction).toBe('TX');

    // frame name "Generic_Name_12" must not break parsing
    expect(msgs[2].id).toBe(0x30a);
    expect(msgs[2].data[0]).toBe(0x01);
    expect(msgs[2].brs).toBe(true);
    expect(msgs[2].esi).toBe(true);
  });

  it('generateASC round-trips CAN FD messages', () => {
    const msgs = parseASCFile('test_CanFdMessage64.asc');
    const out = generateASC(['base hex  timestamps absolute'], msgs);
    const reparsed = [];
    for (const line of out.split(/\r?\n/)) {
      if (isNonDataLine(line)) continue;
      const m = parseASCDataLine(line);
      if (m) reparsed.push(m);
    }
    expect(reparsed.length).toBe(msgs.length);
    for (let i = 0; i < msgs.length; i++) {
      expect(reparsed[i].id).toBe(msgs[i].id);
      expect(reparsed[i].dlc).toBe(msgs[i].dlc);
      expect(reparsed[i].data).toEqual(msgs[i].data);
      expect(reparsed[i].isFd).toBe(true);
      expect(reparsed[i].brs).toBe(msgs[i].brs);
      expect(reparsed[i].esi).toBe(msgs[i].esi);
    }
  });
});

describe('CAN FD BLF parsing', () => {
  it('parses the real 64-byte CAN FD BLF via the fallback parser (LOG_CONTAINER + type 101)', () => {
    const buf = fs.readFileSync(path.join(base, 'test_CanFdMessage64.blf'));
    const msgs = parseBLFBuffer(buf, new Set());
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    for (const m of msgs) {
      expect(m.isFd).toBe(true);
      expect(m.data.length).toBe(64);
      // python-can test payload is 0..63
      expect(m.data[0]).toBe(0);
      expect(m.data[63]).toBe(63);
    }
  });

  it('ASC -> BLF -> parse round-trip keeps 64-byte FD data intact', () => {
    const msgs = parseASCFile('test_CanFdMessage64.asc');
    const blf = buildBLFBuffer(msgs);
    const back = parseBLFBuffer(blf, new Set());
    expect(back.length).toBe(msgs.length);
    for (let i = 0; i < msgs.length; i++) {
      expect(back[i].id).toBe(msgs[i].id);
      expect(back[i].dlc).toBe(msgs[i].dlc);
      expect(back[i].data).toEqual(msgs[i].data);
      expect(back[i].isFd).toBe(true);
    }
  });
});

describe('CAN FD DBC decoding (64-byte payloads)', () => {
  const dbcMessages = parseDBC(fs.readFileSync(path.join(base, 'canfd_test.dbc'), 'utf8'));

  function signal(id, name) {
    const m = dbcMessages.find(x => x.id === id);
    return m ? m.signals.find(s => s.name === name) : null;
  }

  function msgOf(id) {
    return parseASCFile('test_CanFdMessage64.asc').concat(parseASCFile('test_CanFdMessage.asc'))
      .find(m => m.id === id);
  }

  it('loads all messages incl. extended-ID and 64-byte DLC', () => {
    expect(dbcMessages.map(m => m.id)).toEqual(
      expect.arrayContaining([1262, 474841255, 768, 778])
    );
    expect(dbcMessages.find(m => m.id === 1262).dlc).toBe(64);
  });

  it('decodes signals spanning the full 64-byte range (MSG64A)', () => {
    const data = msgOf(1262).data;
    expect(data.length).toBe(64);
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte0'))).toBe(0xA1);
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte1'))).toBe(0x02);
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte2_3'))).toBe(0x0403);      // bytes[2..3] LE
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte7'))).toBe(0x00);
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte62_63'))).toBe(0x6400);    // bytes[62..63] LE
    expect(decodeSignalFrame(data, signal(1262, 'A_Byte63'))).toBe(0x64);         // last byte
    expect(decodeSignalFrame(data, signal(1262, 'A_U32_60'))).toBe(0x64000000);   // bytes[60..63] LE
    expect(decodeSignalFrame(data, signal(1262, 'A_U64_0'))).toBe(67306145);      // bytes[0..7] LE
  });

  it('decodes signals on the extended-ID 64-byte message (MSG64B)', () => {
    const data = msgOf(474841255).data;
    expect(data.length).toBe(64);
    expect(decodeSignalFrame(data, signal(474841255, 'B_Byte0'))).toBe(0xB1);
    expect(decodeSignalFrame(data, signal(474841255, 'B_Byte63'))).toBe(0x64);
  });

  it('decodes classic-DLC CAN FD frames (8 bytes)', () => {
    const data = msgOf(768).data;
    expect(decodeSignalFrame(data, signal(768, 'C_Byte0'))).toBe(0x11);
    expect(decodeSignalFrame(data, signal(768, 'C_Byte7'))).toBe(0x08);
    expect(decodeSignalFrame(data, signal(768, 'C_U16_2'))).toBe(0x0403);
    expect(decodeSignalFrame(data, signal(768, 'C_All32'))).toBe(0x0403C211);
  });
});

describe('CAN FD rich multi-frame scenario (TestExample/canfd_rich)', () => {
  const richBase = path.join(__dirname, '..', '..', 'TestExample', 'canfd_rich');
  const dbcMessages = parseDBC(fs.readFileSync(path.join(richBase, 'vehicle_canfd.dbc'), 'utf8'));

  function parseASCFile(file) {
    const msgs = [];
    for (const line of fs.readFileSync(path.join(richBase, file), 'utf8').split(/\r?\n/)) {
      if (isNonDataLine(line)) continue;
      const m = parseASCDataLine(line);
      if (m) msgs.push(m);
    }
    return msgs;
  }

  it('parses 30 ASC frames: 15x 64-byte VCU_STATE + 15x 32-byte BMS_PACK', () => {
    const msgs = parseASCFile('vehicle_canfd.asc');
    expect(msgs.length).toBe(30);
    const vcu = msgs.filter(m => m.id === 256);
    const bms = msgs.filter(m => m.id === 512);
    expect(vcu.length).toBe(15);
    expect(bms.length).toBe(15);
    for (const m of vcu) {
      expect(m.isFd).toBe(true);
      expect(m.dlc).toBe(64);
      expect(m.data.length).toBe(64);
      expect(m.brs).toBe(true);
    }
    for (const m of bms) {
      expect(m.isFd).toBe(true);
      expect(m.dlc).toBe(32);
      expect(m.data.length).toBe(32);
    }
  });

  it('parses the DBC: 64-byte VCU_STATE with 42 signals + 32-byte BMS_PACK with 22 signals', () => {
    const vcu = dbcMessages.find(m => m.id === 256);
    const bms = dbcMessages.find(m => m.id === 512);
    expect(vcu).toBeTruthy();
    expect(vcu.dlc).toBe(64);
    expect(vcu.signals.length).toBe(42);
    expect(bms).toBeTruthy();
    expect(bms.dlc).toBe(32);
    expect(bms.signals.length).toBe(22);
    // signals must cover the whole 64-byte range (B0..B63)
    const maxBit = Math.max(...vcu.signals.map(s => s.startBit + s.length - 1));
    expect(maxBit).toBeGreaterThanOrEqual(503); // B62..B63 region
  });

  it('decodes signals across the full 64-byte range', () => {
    const vcu = dbcMessages.find(m => m.id === 256);
    const frame = parseASCFile('vehicle_canfd.asc').find(m => m.id === 256);
    const s = name => vcu.signals.find(x => x.name === name);
    expect(decodeSignalFrame(frame.data, s('VehicleSpeed'))).toBeCloseTo(40, 0);   // B0-B1
    expect(decodeSignalFrame(frame.data, s('BatteryVoltage'))).toBeCloseTo(380, 0); // B8-B9
    expect(decodeSignalFrame(frame.data, s('Odometer'))).toBe(12345);              // B30-B33 (32-bit, *0.001 km)
    expect(decodeSignalFrame(frame.data, s('PackVoltage'))).toBeCloseTo(396, 0);   // B55-B56
    expect(decodeSignalFrame(frame.data, s('CellVoltMin'))).toBeCloseTo(3.8, 1);   // B61-B62
    expect(decodeSignalFrame(frame.data, s('CellTempMax'))).toBe(35);              // B63
  });

  it('reads the generated BLF back with identical 64-byte/32-byte payloads', () => {
    const buf = fs.readFileSync(path.join(richBase, 'vehicle_canfd.blf'));
    const msgs = parseBLFBuffer(buf, new Set());
    expect(msgs.length).toBe(30);
    const vcu = msgs.filter(m => m.id === 256);
    const bms = msgs.filter(m => m.id === 512);
    expect(vcu.length).toBe(15);
    expect(bms.length).toBe(15);
    for (const m of vcu) {
      expect(m.isFd).toBe(true);
      expect(m.data.length).toBe(64);
      expect(m.dlc).toBe(64);
    }
    for (const m of bms) {
      expect(m.isFd).toBe(true);
      expect(m.data.length).toBe(32);
    }
  });
});
