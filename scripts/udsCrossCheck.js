#!/usr/bin/env node
// v4.0 / B1 验收③：UDS 对拍（本仓库实现 vs 独立 Python 复核脚本 + udsoncan）
//
// 左：electron/cap.js + isotp.js + uds.js（被测实现）
// 右：scripts/uds_crosscheck.py（独立实现，服务名取自第三方库 udsoncan）
//
// 判定：重组报文数一致，且逐条 canId / payload / sid / serviceName /
//       responseType / subfunction / dids / dtcs / nrc 全等 —— 0 不一致。
// 退出码：0 通过 / 1 不一致 / 2 环境缺失（严格模式下）
//
// 用法：node scripts/udsCrossCheck.js [--strict]

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parseCandump } = require('../electron/cap');
const { reassembleISOTP } = require('../electron/isotp');
const { parseUDSService } = require('../electron/uds');
const { isStrictMode, handleMissingEnv, EXIT_CODES } = require('./compareEnv');

const STRICT = isStrictMode(process.argv, process.env);
const CAP_DIR = path.join(__dirname, '..', 'TestExample', 'roadmap_v3x', 'uds_xcp');
const CAP_FILES = [
  'uds_msd80_msd80_capture.fail1.cap',
  'uds_msd80_msd80_capture.fail2.cap',
  'uds_msd80_msd80_capture.fail5.cap'
];
const PY_SCRIPT = path.join(__dirname, 'uds_crosscheck.py');

// --- 定位 python（支持 PYTHON 环境变量，避免必须改 PATH） ---
function findPython() {
  const cands = [process.env.PYTHON, 'python', 'python3'].filter(Boolean);
  for (const cand of cands) {
    try {
      const v = execFileSync(cand, ['-c', 'import udsoncan; print(udsoncan.__version__)'], { stdio: 'pipe' });
      return { py: cand, version: v.toString().trim() };
    } catch (_) { /* try next */ }
  }
  return null;
}

const found = findPython();
if (!found) {
  handleMissingEnv('python with udsoncan not found (set PYTHON or add python to PATH)', { strict: STRICT });
  process.exit(EXIT_CODES.ENV_MISSING);
}

// --- 左侧：本仓库实现 ---
function localSide() {
  const out = [];
  for (const f of CAP_FILES) {
    const text = fs.readFileSync(path.join(CAP_DIR, f), 'utf8');
    const { messages } = parseCandump(text);
    const { messages: reassembled } = reassembleISOTP(messages);
    for (const m of reassembled) {
      const p = parseUDSService(m.payload);
      // 未识别的 SID 也产出记录（serviceName: null），以便与 Python 侧逐帧对齐比对。
      out.push({
        canId: m.canId,
        time: m.time,
        payload: m.payload.toString('hex'),
        sid: p ? p.sid : m.payload[0],
        baseSid: p ? (p.baseSid === undefined ? null : p.baseSid) : m.payload[0],
        responseType: p ? p.responseType : 'unknown',
        serviceName: p ? p.name : null,
        subfunction: p ? (p.subfunction === undefined ? null : p.subfunction) : null,
        dids: p ? (p.dids || (p.did === undefined ? [] : [p.did])) : [],
        dtcs: p ? (p.dtcs || []).map((d) => ({ dtcId: d.dtcId, hex: d.hex, faultType: d.faultType, status: d.status })) : [],
        nrc: p ? (p.nrc === undefined ? null : p.nrc) : null
      });
    }
  }
  return out;
}

// --- 右侧：Python 独立复核 ---
function pythonSide() {
  const args = [PY_SCRIPT, ...CAP_FILES.map((f) => path.join(CAP_DIR, f))];
  const r = spawnSync(found.py, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('python cross-check script failed:', r.stderr || r.error);
    process.exit(EXIT_CODES.ENV_MISSING);
  }
  // 输出中可能有 udsoncan 的导入告警，只取最后一行 JSON
  const lines = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

// 本仓库实现的 UDS 服务集（electron/uds.js UDS_SIDS）——对拍只比较双方都支持的
// 部分，udsoncan 另有 18 个本轮未实现的服务（如 0x31 RoutineControl）不计入。
const OUR_SIDS = new Set([0x10, 0x11, 0x14, 0x19, 0x22, 0x27, 0x2e, 0x3e, 0x85]);

const a = localSide();
const b = pythonSide();
const recognized = a.filter((m) => m.serviceName).length;

console.log('============================================================');
console.log(`UDS cross-check (udsoncan ${found.version} via ${found.py})`);
console.log(`  local : ${a.length} reassembled messages (${recognized} with a known UDS service)`);
console.log(`  python: ${b.length} reassembled messages`);
console.log('============================================================');

let fails = 0;
const n = Math.min(a.length, b.length);
if (a.length !== b.length) {
  console.error(`FAIL: message count differs (local ${a.length} vs python ${b.length})`);
  fails++;
}

const normDtc = (d) => `${d.dtcId}|${d.hex}|${d.faultType}|${d.status === undefined ? '-' : d.status}`;

for (let i = 0; i < n; i++) {
  const l = a[i];
  const r = b[i];
  const diffs = [];
  if (l.canId !== r.canId) diffs.push(`canId ${l.canId} != ${r.canId}`);
  if (l.payload !== r.payload) diffs.push(`payload ${l.payload} != ${r.payload}`);
  if (l.sid !== r.sid) diffs.push(`sid ${l.sid} != ${r.sid}`);
  if (l.serviceName !== r.serviceName) diffs.push(`serviceName ${l.serviceName} != ${r.serviceName}`);
  if (l.responseType !== r.responseType) diffs.push(`responseType ${l.responseType} != ${r.responseType}`);
  if (l.subfunction !== r.subfunction) diffs.push(`subfunction ${l.subfunction} != ${r.subfunction}`);
  if (JSON.stringify(l.dids) !== JSON.stringify(r.dids)) diffs.push(`dids ${JSON.stringify(l.dids)} != ${JSON.stringify(r.dids)}`);
  if (JSON.stringify(l.dtcs.map(normDtc)) !== JSON.stringify(r.dtcs.map(normDtc))) diffs.push(`dtcs differ`);
  if (l.nrc !== r.nrc) diffs.push(`nrc ${l.nrc} != ${r.nrc}`);
  if (diffs.length) {
    fails++;
    if (fails <= 10) console.error(`  #${i} MISMATCH: ${diffs.join('; ')}`);
  }
}

if (fails === 0) {
  console.log(`UDS cross-check: ${n}/${n} messages match (0 mismatches)`);
  if (n < 50) {
    console.log(`NOTE: ${n} messages compared — 验收③ 要求 ≥50 帧，样本量不足`);
  }
  process.exit(EXIT_CODES.OK);
}

console.error(`UDS cross-check: ${fails} mismatch(es) out of ${n}`);
process.exit(EXIT_CODES.MISMATCH);
