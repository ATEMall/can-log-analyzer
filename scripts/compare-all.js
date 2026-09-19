#!/usr/bin/env node
// =====================================================================
// #22 — 统一对拍入口：跑完 TestExample 下所有 compare.js
//
//   npm run compare                 # 普通模式（无 cantools 时 skip + 显著提示）
//   npm run compare -- --strict     # 严格模式（无 cantools 时非零退出，CI 用）
//
// 参数透传给每个 compare.js；任一子脚本非零退出则整体非零退出。
// =====================================================================

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isStrictMode, EXIT_CODES } = require('./compareEnv');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'TestExample');
const args = process.argv.slice(2);
const strict = isStrictMode(args, process.env);

function findCompareFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      findCompareFiles(full, out);
    } else if (e.isFile() && e.name === 'compare.js') {
      out.push(full);
    }
  }
  return out.sort();
}

const files = findCompareFiles(EXAMPLES);
if (files.length === 0) {
  console.error('FATAL: no TestExample/**/compare.js found');
  process.exit(EXIT_CODES.ENV_MISSING);
}

console.log(`cantools cross-check: ${files.length} harness(es), strict=${strict ? 'yes' : 'no'}`);

const results = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  console.log(`\n----- ${rel} -----`);
  const r = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', cwd: ROOT });
  const code = typeof r.status === 'number' ? r.status : 1;
  results.push({ rel, code });
}

console.log('\n================ summary ================');
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.rel}${ok ? '' : `  (exit ${r.code})`}`);
}
if (failed > 0) {
  console.error(`\n${failed}/${results.length} harness(es) failed`);
  process.exit(EXIT_CODES.MISMATCH);
}
console.log(`\n${results.length}/${results.length} harness(es) passed`);
if (!strict) {
  console.log('NOTE: non-strict run — a harness without cantools was SKIPPED, not verified. Use --strict in CI.');
}
process.exit(EXIT_CODES.OK);
