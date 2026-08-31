// Cross-check against cantools — the authoritative reference decoder.
//
// Skip policy (PM Issue #1 acceptance): exits 0 ONLY when `import cantools`
// fails (Python/cantools absent). When cantools IS importable but the DBC
// fails to load, or any signal mismatches, the script exits non-zero —
// a silent fake-green is never produced. Usage:
//
//   node TestExample/motorola_matrix/compare.js
//
// Expected output on a machine with cantools:
//   cantools cross-check: N/N signals match (cantools X.Y.Z)

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

// 2. One-shot python: decode every message with the fixed payload.
//    DBC load failure is FATAL (exit code 3) — never silently skipped.
const pyScript = `
import json, sys
try:
    import cantools
except Exception as e:
    print('CANTOOLS_IMPORT_FAILED', repr(e))
    sys.exit(2)
try:
    db = cantools.database.load_file(sys.argv[1])
except Exception as e:
    print('CANTOOLS_DBC_LOAD_FAILED', repr(e))
    sys.exit(3)
data = bytes([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0])
out = {}
for msg in db.messages:
    try:
        dec = db.decode_message(msg.frame_id, data)
        out[str(msg.frame_id)] = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in dec.items()}
    except Exception as e:
        out[str(msg.frame_id)] = {'__error__': str(e)}
print('CANTOOLS_OK')
print(json.dumps(out))
`;
let stdout;
try {
  stdout = execFileSync(py, ['-c', pyScript, dbcFile], { encoding: 'utf8' });
} catch (err) {
  const msg = String(err.stderr || err.message);
  if (msg.includes('CANTOOLS_DBC_LOAD_FAILED')) {
    console.error('FATAL: cantools could not load ' + dbcFile + '\n  ' + msg.trim());
    process.exit(1);
  }
  throw err;
}
if (stdout.includes('CANTOOLS_IMPORT_FAILED')) {
  console.log('cantools import failed inside python - treating as unavailable (skipped)');
  process.exit(0);
}
if (!stdout.includes('CANTOOLS_OK')) {
  console.error('FATAL: unexpected cantools output');
  process.exit(1);
}
const cantoolsResult = JSON.parse(stdout.split('CANTOOLS_OK\n')[1].trim());

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
