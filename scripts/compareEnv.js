// =====================================================================
// #22 — cantools 对拍的「严格模式」判定与提示文案（纯模块，可单测）
//
// 背景：验收基线要求 cantools 43.0.2 对拍 0 不一致，但 compare.js 在
// 开发机无 Python/cantools 时走 skip + exit 0 ——「对拍通过」实为未执行
// （#12 / #7 均因此不可见）。本模块把「是否严格模式」与「缺失环境的处置」
// 抽成单一来源，供所有 compare.js 与 npm run compare 复用。
// =====================================================================

const STRICT_FLAG = '--strict';

/** 严格模式：显式 --strict、CI 环境，或 CANTOOLS_STRICT=1。 */
function isStrictMode(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  if (args.includes(STRICT_FLAG)) return true;
  const e = env || {};
  if (e.CI === '1' || e.CI === 'true') return true;
  if (e.CANTOOLS_STRICT === '1' || e.CANTOOLS_STRICT === 'true') return true;
  return false;
}

/** 退出码：区分「环境缺失」与「真的对拍不一致」，便于 CI 定位。 */
const EXIT_CODES = {
  OK: 0,
  MISMATCH: 1,        // 解码结果不一致
  IMPORT_FAILED: 2,   // python 能跑但 import cantools 失败
  DBC_LOAD_FAILED: 3, // cantools 加载 DBC 失败
  ENV_MISSING: 4      // 严格模式下 Python/cantools 不可用（普通模式会 skip）
};

/** 普通模式下的显著提示：明确告诉读者「本次没有真正对拍」。 */
function skipNotice(reason) {
  const detail = reason ? `\n  reason: ${reason}` : '';
  return [
    '============================================================',
    'WARNING: cantools unavailable -> cross-check NOT executed (skipped)',
    '  This run provides NO evidence about decode correctness.',
    '  Fix:  pip install -r requirements.txt   (cantools==43.0.2)',
    '  Fail instead of skipping:  npm run compare -- --strict',
    `============================================================${detail}`
  ].join('\n');
}

/** 严格模式下的致命报错（非零退出前打印）。 */
function strictFailure(reason) {
  return [
    `FATAL: cantools cross-check required but unavailable (${reason}).`,
    '  Install the pinned environment:  pip install -r requirements.txt',
    '  Expected: cantools==43.0.2 (decode reference for the acceptance baseline).'
  ].join('\n');
}

/**
 * 统一处置「cantools 不可用」：
 *   - 普通模式：打印显著提示并 exit 0（保留跳过行为）
 *   - 严格模式：打印 FATAL 并 exit 4
 * 返回 true 表示调用方应立即以给定 code 退出。
 */
function handleMissingEnv(reason, options) {
  const opts = options || {};
  const strict = opts.strict !== undefined ? opts.strict : isStrictMode(opts.argv, opts.env);
  const log = opts.log || console.log;
  const err = opts.error || console.error;
  const exit = opts.exit || (code => process.exit(code));

  if (strict) {
    err(strictFailure(reason));
    exit(EXIT_CODES.ENV_MISSING);
  } else {
    log(skipNotice(reason));
    exit(EXIT_CODES.OK);
  }
  return true;
}

module.exports = {
  STRICT_FLAG,
  EXIT_CODES,
  isStrictMode,
  skipNotice,
  strictFailure,
  handleMissingEnv
};
