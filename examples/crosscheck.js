// Standalone cross-check: validate electron/signalDecode.js against an INDEPENDENT
// reference decoder over the real example DBCs, plus the cantools motohawk known-answer.
// Run:  node examples/crosscheck.js
// (No external deps; uses the repo's actual decode engine.)
const fs = require('fs');
const path = require('path');
const { decodeSignalFrame, decodeSignalRawValue } = require('../electron/signalDecode');

// ---- minimal DBC parser (same fields as electron/main.js parseDBC) ----
function parseDBC(content) {
  const messages = []; const lines = content.split(/\r?\n/); let cur = null; const valueDefs = {};
  for (const line of lines) {
    const t = line.trim();
    const mm = t.match(/^BO_\s+(\d+)\s+([\w\-\.]+)\s*:\s*(\d+)\s+([\w\-\.]+)/);
    if (mm) { if (cur) messages.push(cur); cur = { id: +mm[1], name: mm[2], dlc: +mm[3], signals: [] }; continue; }
    const sm = t.match(/^SG_\s+([\w\-\.]+)\s*(M|m\d+M?|)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\((-?[\d.eE+\-]+),(-?[\d.eE+\-]+)\)/);
    if (sm && cur) cur.signals.push({
      name: sm[1], muxIndicator: (sm[2] || '').trim(), startBit: +sm[3], length: +sm[4],
      byteOrder: sm[5] === '1' ? 'little' : 'big', signed: sm[6] === '-', scale: parseFloat(sm[7]), offset: parseFloat(sm[8])
    });
  }
  if (cur) messages.push(cur);
  return messages;
}

// ---- independent reference decoder (different algorithm than the engine) ----
function uint8ToBin(b) { return ('00000000' + (b >>> 0).toString(2)).slice(-8); }
function toSigned(s, signed) {
  if (!signed) return Number(BigInt('0b' + s));
  if (s[0] === '1') { let inv = ''; for (const c of s) inv += c === '0' ? '1' : '0'; return -(Number(BigInt('0b' + inv)) + 1); }
  return Number(BigInt('0b' + s));
}
function refRaw(payload, sig) {
  if (sig.byteOrder === 'little') {                       // Intel: reversed-byte MSB-first slice
    const bits = payload.slice().reverse().map(uint8ToBin).join('');
    const i = bits.length - sig.startBit - sig.length;
    if (i < 0) return NaN;
    return toSigned(bits.slice(i, i + sig.length), sig.signed);
  }
  const n = payload.length;                               // Motorola: MSB0-sequential
  const bitAt = idx => { const b = idx >> 3, k = idx & 7; return b < n ? ((payload[b] >> (7 - k)) & 1) : 0; };
  const start = 8 * Math.floor(sig.startBit / 8) + (7 - (sig.startBit % 8));
  let s = ''; for (let i = 0; i < sig.length; i++) s += bitAt(start + i);
  return toSigned(s, sig.signed);
}

let rng = 0x2545F491 >>> 0;
const rb = () => { rng ^= rng << 13; rng >>>= 0; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0; return rng & 0xFF; };
function maxByte(s) {
  if (s.byteOrder === 'little') return Math.floor((s.startBit + s.length - 1) / 8);
  let bp = s.startBit, mb = 0;
  for (let i = 0; i < s.length; i++) { mb = Math.max(mb, bp >> 3); if ((bp % 8) === 0) bp += 15; else bp--; }
  return mb;
}

let total = 0, mismatch = 0;
for (const f of ['motohawk.dbc', 'vehicle.dbc', 'foobar.dbc']) {
  const msgs = parseDBC(fs.readFileSync(path.join(__dirname, 'dbc', f), 'utf8'));
  let n = 0, mis = 0;
  for (const m of msgs) {
    if (!m.dlc) continue;
    for (let k = 0; k < 50; k++) {
      const payload = Array.from({ length: m.dlc }, rb);
      for (const sig of m.signals) {
        if (maxByte(sig) >= m.dlc) continue;
        const a = decodeSignalFrame(payload, sig);
        const r = refRaw(payload, sig);
        const ref = r * (sig.scale === undefined ? 1 : sig.scale) + (sig.offset === undefined ? 0 : sig.offset);
        n++; total++;
        if (Math.abs(a - ref) > 1e-9 * Math.max(1, Math.abs(ref))) { mis++; mismatch++; }
      }
    }
  }
  console.log(`${f.padEnd(14)} comparisons=${n}  mismatches=${mis}  ${mis === 0 ? 'OK' : 'FAIL'}`);
}

// cantools motohawk canonical known-answer
const fr = [0xc0, 0x06, 0xe0, 0, 0, 0, 0, 0];
const en = decodeSignalRawValue(fr, { startBit: 7, length: 1, byteOrder: 'big', signed: false });
const av = decodeSignalFrame(fr, { startBit: 6, length: 6, byteOrder: 'big', signed: false, scale: 0.1, offset: 0 });
const tp = decodeSignalFrame(fr, { startBit: 0, length: 12, byteOrder: 'big', signed: true, scale: 0.01, offset: 250 });
const canonOk = en === 1 && Math.abs(av - 3.2) < 1e-9 && Math.abs(tp - 250.55) < 1e-9;
console.log(`motohawk canonical: Enable=${en}(exp1) AverageRadius=${av}(exp3.2) Temperature=${tp}(exp250.55)  ${canonOk ? 'OK' : 'FAIL'}`);

console.log(`\nTOTAL ${total} comparisons, ${mismatch} mismatches -> ${mismatch === 0 && canonOk ? 'PASS' : 'FAIL'}`);
process.exit(mismatch === 0 && canonOk ? 0 : 1);
