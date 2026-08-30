// Motorola (big-endian) decoding regression matrix — R1 / FR-PARSE-001.
//
// v2.0.0 decoded 10/10 Motorola signals wrong (sawtooth +15 bug in
// decodeSignalFrame). This suite:
//   1. asserts fixed expected values on the motorola_matrix sample payload,
//   2. cross-checks the engine against an INDEPENDENT reference decoder over a
//      generated matrix of >=120 signal layouts (Intel/Motorola x signed/
//      unsigned x 1..64 bit x aligned/unaligned) with seeded random payloads.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDBC, decodeSignalFrame, getEnumLabel } from '../dbc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(__dirname, '..', '..', 'TestExample', 'motorola_matrix');

// ---------------------------------------------------------------------------
// Independent reference decoder (different accumulation style, so a same-source
// bug in the engine cannot silently pass). Semantics:
//   - little: bit number p -> byte p/8, in-byte bit p%8; signal LSB at startBit
//   - big   : bit number p -> byte p/8, in-byte bit 7-(p%8); startBit is MSB,
//             bits read in increasing bit-number order
// ---------------------------------------------------------------------------
function refDecode(data, { startBit, length, byteOrder, signed }) {
  let raw = 0n;
  for (let i = 0; i < length; i++) {
    const p = startBit + i;
    const b = p >> 3;
    const bit = byteOrder === 'little' ? (p & 7) : (7 - (p & 7));
    const v = b < data.length ? BigInt((data[b] >> bit) & 1) : 0n; // out-of-range -> 0
    if (byteOrder === 'little') {
      raw |= v << BigInt(i);
    } else {
      raw = (raw << 1n) | v; // MSB-first accumulation
    }
  }
  let n;
  if (length <= 32) {
    n = Number(raw);
    if (signed && n >= 2 ** (length - 1)) n -= 2 ** length;
  } else {
    const signBit = 1n << BigInt(length - 1);
    if (signed && (raw & signBit)) raw -= 1n << BigInt(length);
    n = Number(raw);
  }
  return n;
}

// Seeded PRNG so the matrix is reproducible
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Motorola fixed expectations (payload 12 34 56 78 9A BC DE F0)', () => {
  const DATA = [0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0];
  const dbcMessages = parseDBC(fs.readFileSync(path.join(base, 'motorola_matrix.dbc'), 'utf8'));

  function msg(id) { return dbcMessages.find(m => m.id === id); }
  function sig(id, name) { return msg(id).signals.find(s => s.name === name); }

  it('parses all 5 messages (4 Motorola + 1 Intel control)', () => {
    expect(dbcMessages.map(m => m.id).sort((a, b) => a - b)).toEqual([512, 513, 514, 515, 516]);
    expect(dbcMessages.reduce((n, m) => n + m.signals.length, 0)).toBe(23);
  });

  it.each([
    [512, 'M_MotA', 0x1234], [512, 'M_MotB', 0x5678], [512, 'M_MotC', 0x9ABC], [512, 'M_MotD', 0xDEF0],
    [513, 'M_MotU8a', 0x12], [513, 'M_MotU12', 0x345], [513, 'M_MotU4a', 6], [513, 'M_MotU4b', 7],
    [513, 'M_MotU2', 2], [513, 'M_MotBit1', 1], [513, 'M_MotBit0', 0],
    [513, 'M_MotS8', 0xBC - 0x100], [513, 'M_MotU16u', 0xDEF0],
    [514, 'M_MotU32', 0x12345678], [514, 'M_MotS16', 0x9ABC - 0x10000],
    [514, 'M_MotS8b', 0xDE - 0x100], [514, 'M_MotU8c', 0xF0],
    [515, 'M_MotScaled', 0x1234 * 0.1 - 40], [515, 'M_MotEnum', 0x56],
    [515, 'M_MotU40', 0x789ABCDEF0],
    [516, 'M_IntU16', 0x3412], [516, 'M_IntS16', 0x7856], [516, 'M_IntU32', 0xF0DEBC9A],
  ])('decodes %s.%s correctly', (id, name, expected) => {
    const s = sig(id, name);
    expect(s.byteOrder).toBe(id === 516 ? 'little' : 'big');
    expect(decodeSignalFrame(DATA, s)).toBe(expected);
  });

  it('applies factor/offset and enum labels (cantools semantics)', () => {
    expect(decodeSignalFrame(DATA, sig(515, 'M_MotScaled'))).toBe(426);
    expect(getEnumLabel(sig(515, 'M_MotEnum'), 86)).toBe('RUN');
  });
});

describe('Generated matrix: engine vs independent reference (0 mismatch)', () => {
  const rnd = mulberry32(0xC0FFEE);
  const LENGTHS = [1, 3, 4, 8, 12, 16, 24, 32, 40, 64];
  const BYTE_ORDERS = ['little', 'big'];
  const SIGNED = [false, true];
  // aligned + unaligned start bits; kept within a 64-byte payload
  const ALIGNED = [0, 8, 16, 24, 32, 40, 48, 56];
  const UNALIGNED = [1, 7, 9, 15, 25, 33, 47, 55];

  it('matches the independent reference on every layout in the matrix', () => {
    let cases = 0;
    for (const byteOrder of BYTE_ORDERS) {
      for (const signed of SIGNED) {
        for (const length of LENGTHS) {
          const starts = [...ALIGNED, ...UNALIGNED].filter(sb => sb + length <= 64 * 8);
          for (const startBit of starts) {
            cases++;
            const dataLen = 8 + Math.floor(rnd() * 57); // 8..64 bytes
            const data = Array.from({ length: dataLen }, () => Math.floor(rnd() * 256));
            const signal = { startBit, length, byteOrder, signed, scale: 1, offset: 0 };
            const want = refDecode(data, signal);
            const got = decodeSignalFrame(data, signal);
            expect(got, `${byteOrder} ${signed ? 's' : 'u'} ${length}bit @${startBit}`).toBe(want);
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(60);
  });
});

describe('Motorola signed negatives (>32-bit and boundary values)', () => {
  it('64-bit signed negative: 0xFFFFFFFFFFFFFFFF -> -1', () => {
    const data = new Array(8).fill(0xFF);
    const s = { startBit: 0, length: 64, byteOrder: 'big', signed: true, scale: 1, offset: 0 };
    expect(decodeSignalFrame(data, s)).toBe(-1);
  });
  it('64-bit signed positive with MSB clear: 0x7FFF... -> 9223372036854775807', () => {
    const data = [0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const s = { startBit: 0, length: 64, byteOrder: 'big', signed: true, scale: 1, offset: 0 };
    expect(decodeSignalFrame(data, s)).toBe(Number.MAX_SAFE_INTEGER > 0 ? 9223372036854775807 : 9223372036854775807);
  });
  it('signed boundary: raw == 2^(n-1) is the most negative value', () => {
    const data = [0x80, 0x00, 0x00, 0x00];
    const s = { startBit: 0, length: 32, byteOrder: 'big', signed: true, scale: 1, offset: 0 };
    expect(decodeSignalFrame(data, s)).toBe(-2147483648);
  });
  it('data shorter than signal start: missing bits read as 0 (no crash)', () => {
    const data = [0x12];
    const s = { startBit: 16, length: 16, byteOrder: 'big', signed: true, scale: 1, offset: 0 };
    expect(decodeSignalFrame(data, s)).toBe(0);
  });
});

describe('motorola_matrix sample files exist and round-trip', () => {
  it('generate.js output is committed: ASC + BLF present', () => {
    expect(fs.existsSync(path.join(base, 'motorola_matrix.asc'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'motorola_matrix.blf'))).toBe(true);
  });
});
