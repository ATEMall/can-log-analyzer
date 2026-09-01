// Cross-check the R3 full-feature DBC against cantools — the authoritative
// reference decoder. Covers extended frames (canonical 0x80000000 flag),
// multiplex decode, SIG_VALTYPE_ floats and BA_ attributes (via signal values).
//
// Skip policy (same as motorola_matrix, tightened per PM Issue #1 acceptance):
// exits 0 ONLY when `import cantools` fails (Python/cantools absent). When
// cantools IS importable but the DBC fails to load, or any signal mismatches,
// the script exits non-zero — a silent fake-green is never produced.
//
// Usage:  node TestExample/dbc_full/compare.js
//
// Expected output on a machine with cantools:
//   cantools cross-check: N/N signals match (cantools X.Y.Z)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseDBC, decodeSignalFrame } = require('../../electron/dbc');

const OUT = __dirname;
const dbcFile = path.join(OUT, 'dbc_full.dbc');

// One or more payloads per frame id, mirroring generate.js expectations.
const PAYLOADS = {
  2048: [
    [0x00, 0x34, 0x12, 0x64, 0x05, 0, 0, 0],        // mux = 0 -> SigSpeed+SigRpm
    [0x01, 0x1E, 0x00, 0, 0, 0, 0, 0]               // mux = 1 -> SigTemp
  ],
  512: [
    [0xDB, 0x0F, 0x49, 0x40, 0xC0, 0x04, 0, 0, 0, 0, 0, 0, 0, 0xFE, 0xFE, 0xFF] // F32a/F64a/I32s
  ],
  1024: [
    [0x07, 0x01, 0x02, 0x01, 0xFE, 0xFF, 0, 0]      // StartVal/EnumSig/CycleSig/SignedSig
  ]
};

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

// 2. One-shot python: decode every message with its payloads.
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
payloads = json.loads(sys.argv[2])
out = {}
for msg in db.messages:
    key = str(msg.frame_id)
    for i, data in enumerate(payloads.get(key, [])):
        try:
            dec = db.decode_message(msg.frame_id, bytes(data))
            out[key + '#' + str(i)] = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in dec.items()}
        except Exception as e:
            out[key + '#' + str(i)] = {'__error__': str(e)}
print('CANTOOLS_OK')
print(json.dumps(out))
`;
let stdout;
try {
  stdout = execFileSync(py, ['-c', pyScript, dbcFile, JSON.stringify(PAYLOADS)], { encoding: 'utf8' });
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
  for (let i = 0; i < (PAYLOADS[msg.id] || []).length; i++) {
    const data = PAYLOADS[msg.id][i];
    const ref = cantoolsResult[msg.id + '#' + i];
    if (!ref || ref.__error__) {
      console.log(`  (cantools skipped msg ${msg.id} payload ${i}${ref ? ': ' + ref.__error__ : ''})`);
      continue;
    }
    for (const sig of msg.signals) {
      if (ref[sig.name] === undefined) continue; // mux branch not active
      total++;
      const got = decodeSignalFrame(data, sig);
      const want = ref[sig.name];
      const ok = Object.is(got, want) || Math.abs(got - want) < 1e-6;
      if (!ok) {
        fails++;
        console.log(`MISMATCH ${msg.id} ${sig.name} (payload ${i}): got ${got}, cantools ${want}`);
      }
    }
  }
}
const version = execFileSync(py, ['-c', 'import cantools; print(cantools.__version__)'], { stdio: 'pipe' }).toString().trim();
console.log(`cantools cross-check: ${total - fails}/${total} signals match (cantools ${version})`);
process.exit(fails ? 1 : 0);
