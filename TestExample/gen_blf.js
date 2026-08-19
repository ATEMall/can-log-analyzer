// =====================================================================
// TestExample BLF generator + round-trip verifier
// Parses the .asc logs, writes standard Vector BLF files, then reads
// them back with parseBLFBuffer to verify correctness.
// Usage: node TestExample/gen_blf.js
// =====================================================================
const fs = require('fs');
const path = require('path');
const { buildBLFBuffer, parseBLFBuffer } = require('../electron/blf');

function parseASC(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const messages = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('date') || t.startsWith('base') ||
        t.startsWith('internal') || t.startsWith('Begin') || t.startsWith('End')) {
      continue;
    }
    const m = t.match(/^(\d+\.\d+)\s+(\d+)\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+[dx]\s+(\d+)\s+((?:[0-9A-Fa-f]{2}\s*)*)/);
    if (!m) continue;
    const data = m[6].trim().split(/\s+/).filter(Boolean).map(h => parseInt(h, 16));
    messages.push({
      timestamp: parseFloat(m[1]),
      channel: parseInt(m[2]),
      id: parseInt(m[3], 16),
      direction: m[4],
      dlc: parseInt(m[5]),
      data
    });
  }
  return messages;
}

function verify(ascPath, blfPath) {
  const ascMsgs = parseASC(ascPath);
  const buf = buildBLFBuffer(ascMsgs);
  fs.writeFileSync(blfPath, buf);

  // Read back with the same parser used by the app
  const readMsgs = parseBLFBuffer(buf, new Set());

  let mismatches = 0;
  const n = Math.min(ascMsgs.length, readMsgs.length);
  for (let i = 0; i < n; i++) {
    const a = ascMsgs[i];
    const b = readMsgs[i];
    const dataEq = a.data.length === b.data.length &&
      a.data.every((v, j) => v === b.data[j]);
    if (a.id !== b.id || a.dlc !== b.dlc || Math.abs(a.timestamp - b.timestamp) > 1e-6 || !dataEq) {
      mismatches++;
      if (mismatches <= 5) {
        console.log(`  MISMATCH #${i}: asc(id=${a.id.toString(16)}, ts=${a.timestamp}, dlc=${a.dlc}, data=${a.data.join(' ')}) vs blf(id=${b.id.toString(16)}, ts=${b.timestamp.toFixed(6)}, dlc=${b.dlc}, data=${b.data.join(' ')})`);
      }
    }
  }

  const ok = mismatches === 0 && ascMsgs.length === readMsgs.length;
  console.log(`  ${path.basename(ascPath)} -> ${path.basename(blfPath)}:`);
  console.log(`    ASC messages : ${ascMsgs.length}`);
  console.log(`    BLF messages : ${readMsgs.length} (${(buf.length / 1024).toFixed(1)} KB)`);
  console.log(`    ID/DLC/TS/Data round-trip : ${ok ? 'PASS' : `FAIL (${mismatches} mismatches)`}`);
  return ok;
}

const dir = __dirname;
const results = [
  verify(path.join(dir, 'body_chassis.asc'), path.join(dir, 'body_chassis.blf')),
  verify(path.join(dir, 'powertrain.asc'), path.join(dir, 'powertrain.blf'))
];

const allOk = results.every(Boolean);
console.log(allOk ? '\nAll BLF tests PASSED' : '\nBLF tests FAILED');
process.exit(allOk ? 0 : 1);
