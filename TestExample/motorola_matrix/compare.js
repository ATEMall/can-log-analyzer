// Optional cross-check against cantools — the authoritative reference decoder.
//
// Runs only when `python` + `cantools` are available on PATH; otherwise it
// exits 0 (skipped) so `npm test` and CI stay green in sandboxes without
// Python. Usage:
//
//   node TestExample/motorola_matrix/compare.js
//
// Exits non-zero when any signal mismatches cantools.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseDBC, decodeSignalFrame } = require('../../electron/dbc');

const OUT = __dirname;
const dbcFile = path.join(OUT, 'motorola_matrix.dbc');
const DATA = [0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0];

// 1. Locate python + cantools
let py = null;
for (const cand of ['python', 'python3']) {
  try {
    const v = execFileSync(cand, ['-c', 'import cantools; print(cantools.__version__)'], { stdio: 'pipe' });
    if (v && v.toString().trim()) { py = cand; break; }
  } catch { /* not available */ }
}
if (!py) {
  console.log('cantools not available on PATH - external cross-check skipped');
  process.exit(0);
}

// 2. One-shot python: decode every message with the fixed payload
const pyScript = `
import json, sys, cantools
db = cantools.database.load_file(sys.argv[1])
data = bytes([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0])
out = {}
for msg in db.messages:
    try:
        dec = db.decode_message(msg.frame_id, data)
        out[str(msg.frame_id)] = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in dec.items()}
    except Exception as e:
        out[str(msg.frame_id)] = {'__error__': str(e)}
print(json.dumps(out))
`;
const stdout = execFileSync(py, ['-c', pyScript, dbcFile], { encoding: 'utf8' });
const cantoolsResult = JSON.parse(stdout.trim());

// 3. Compare with our engine
const parsed = parseDBC(fs.readFileSync(dbcFile, 'utf8'));
let total = 0;
let fails = 0;
for (const msg of parsed) {
  const ref = cantoolsResult[String(msg.id)];
  if (!ref || ref.__error__) {
    console.log(`  (cantools skipped msg ${msg.id}${ref ? ': ' + ref.__error__ : ''})`);
    continue;
  }
  for (const sig of msg.signals) {
    if (ref[sig.name] === undefined) continue;
    total++;
    const got = decodeSignalFrame(DATA, sig);
    const want = ref[sig.name];
    const ok = Object.is(got, want) || Math.abs(got - want) < 1e-6;
    if (!ok) {
      fails++;
      console.log(`MISMATCH ${msg.id} ${sig.name}: got ${got}, cantools ${want}`);
    }
  }
}
console.log(`cantools cross-check: ${total - fails}/${total} signals match (cantools ${(function () {
  try { return require('child_process').execFileSync(py, ['-c', 'import cantools; print(cantools.__version__)'], { stdio: 'pipe' }).toString().trim(); } catch { return '?'; }
})()})`);
process.exit(fails ? 1 : 0);
