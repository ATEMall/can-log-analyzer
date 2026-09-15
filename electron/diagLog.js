/**
 * R14: application diagnostic log (main process).
 *
 * Writes one log file per day (`app-YYYY-MM-DD.log`) under
 * `%APPDATA%/can-log-analyzer/logs/`, keeps `retentionDays` (default 7) days
 * of history and appends asynchronously so the UI thread is never blocked.
 *
 * Privacy rule: entries must never contain CAN payloads or user file content.
 * `sanitizeDetail()` redacts known content-bearing keys (data / frames /
 * messages / line / ...) and truncates long strings, so a stray caller cannot
 * leak a log corpus through the diagnostics channel.
 *
 * The module is pure (fs + clock injectable) so retention/rotation can be
 * unit tested with fake dates without touching the real userData directory.
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_POINTS = 200; // queued entries per append batch
const MAX_DETAIL_CHARS = 200;
const MAX_ARRAY_ITEMS = 5;
const MAX_DEPTH = 3;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Keys whose value may carry message payloads / raw file content.
const REDACTED_KEYS = new Set([
  'data', 'bytes', 'frames', 'messages', 'loadedMessages', 'signalData',
  'content', 'raw', 'rawContent', 'payload', 'line', 'lines', 'headerLines'
]);
const REDACTED_VALUE = '<redacted>';

const LOG_PREFIX = 'app-';
const LOG_SUFFIX = '.log';
const LOG_NAME_RE = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` for the given Date (local time, matches the user's day). */
function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function logFileName(date) {
  return `${LOG_PREFIX}${dateKey(date)}${LOG_SUFFIX}`;
}

/** Parse `app-YYYY-MM-DD.log` → Date (midnight) or null when not a log file. */
function parseLogDate(name) {
  const m = LOG_NAME_RE.exec(String(name || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days between two Dates (b - a), ignoring the time of day. */
function daysBetween(a, b) {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayB - dayA) / 86400000);
}

function truncateString(value) {
  const s = String(value);
  return s.length > MAX_DETAIL_CHARS ? `${s.slice(0, MAX_DETAIL_CHARS)}…(${s.length} chars)` : s;
}

/**
 * Strip anything that could carry user data out of a log detail object:
 * content-bearing keys are replaced, strings truncated, arrays capped and
 * nesting depth limited.
 */
function sanitizeDetail(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value !== 'object') {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return truncateString(value);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: truncateString(String(value.stack || '').split('\n').slice(0, 4).join(' | '))
    };
  }
  if (depth >= MAX_DEPTH) return truncateString(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(v => sanitizeDetail(v, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACTED_KEYS.has(k) ? REDACTED_VALUE : sanitizeDetail(v, depth + 1);
  }
  return out;
}

/** Single-line, grep-friendly log record. */
function formatEntry({ ts, level, scope, event, detail }) {
  const time = (ts instanceof Date ? ts : new Date(ts)).toISOString();
  const head = `${time} ${String(level || 'info').toUpperCase()} [${scope || 'main'}] ${event || 'event'}`;
  if (detail == null) return head;
  let json = '';
  try {
    json = JSON.stringify(detail);
  } catch {
    json = '{"detail":"<unserializable>"}';
  }
  return json ? `${head} ${json}` : head;
}

/**
 * Delete daily log files older than `retentionDays`. Returns the bookkeeping
 * needed by tests / startup logging; never throws on FS hiccups.
 */
function pruneOldLogs(dir, { now = () => new Date(), retentionDays = DEFAULT_RETENTION_DAYS, fs: fsImpl = fs } = {}) {
  const today = now();
  const result = { dir, retentionDays, kept: [], removed: [], failed: [] };
  let names = [];
  try {
    names = fsImpl.readdirSync(dir);
  } catch {
    return result; // directory does not exist yet — nothing to prune
  }
  for (const name of names) {
    const fileDate = parseLogDate(name);
    if (!fileDate) continue;
    const age = daysBetween(fileDate, today);
    if (age <= retentionDays) {
      result.kept.push(name);
      continue;
    }
    try {
      fsImpl.unlinkSync(path.join(dir, name));
      result.removed.push(name);
    } catch (err) {
      result.failed.push({ name, error: err && err.message ? err.message : String(err) });
    }
  }
  return result;
}

class DiagnosticLogger {
  constructor(options = {}) {
    this.dir = options.dir || null;
    this.retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS;
    this.minLevel = LEVELS[options.minLevel] !== undefined ? LEVELS[options.minLevel] : LEVELS.info;
    this.now = options.now || (() => new Date());
    this.fs = options.fs || fs;
    this.version = options.version || null;
    this.sessionStart = this.now();
    this.queue = [];
    this.batchSize = options.batchSize || DEFAULT_MAX_POINTS;
    this.flushing = false;
    this.stats = { written: 0, dropped: 0, errors: 0 };
    this.dirReady = false;
    this.day = dateKey(this.sessionStart);
  }

  get enabled() {
    return !!this.dir;
  }

  logFilePath(date) {
    return path.join(this.dir, logFileName(date || this.now()));
  }

  /** Current day's log file; exposed for "打开诊断日志" and diagnostics text. */
  currentFilePath() {
    return this.logFilePath();
  }

  log(level, event, detail, scope) {
    if (!this.enabled) return null;
    const numeric = LEVELS[level] !== undefined ? LEVELS[level] : LEVELS.info;
    if (numeric < this.minLevel) return null;
    if (this.queue.length >= 5000) {
      // Never let a runaway renderer grow the queue without bound.
      this.stats.dropped += 1;
      return null;
    }
    const ts = this.now();
    const key = dateKey(ts);
    if (key !== this.day) {
      this.day = key;
      this.dirReady = false;
      this.prune();
    }
    const entry = {
      ts,
      level: LEVELS[level] !== undefined ? level : 'info',
      scope: scope || 'main',
      event: String(event || 'event').slice(0, 120),
      detail: sanitizeDetail(detail)
    };
    entry.line = formatEntry(entry);
    this.queue.push(entry);
    this.scheduleFlush();
    return entry;
  }

  info(event, detail, scope) { return this.log('info', event, detail, scope); }
  warn(event, detail, scope) { return this.log('warn', event, detail, scope); }
  error(event, detail, scope) { return this.log('error', event, detail, scope); }

  scheduleFlush() {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    // Async on purpose: a log write must never block the caller (UI thread).
    setImmediate(() => {
      this.flush().catch(() => { /* flush errors are counted, never thrown */ });
    });
  }

  async ensureDir() {
    if (this.dirReady) return;
    await this.fs.promises.mkdir(this.dir, { recursive: true });
    this.dirReady = true;
  }

  /** Drain the queue to disk. Safe to call manually (e.g. before quit). */
  async flush() {
    if (!this.enabled) return { written: 0 };
    this.flushing = true;
    let written = 0;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.batchSize);
        const text = batch.map(e => e.line).join('\n') + '\n';
        try {
          await this.ensureDir();
          await this.fs.promises.appendFile(this.currentFilePath(), text, { encoding: 'utf8' });
          written += batch.length;
        } catch (err) {
          this.stats.errors += 1;
          if (typeof console !== 'undefined' && console.error) {
            console.error('[diagLog] write failed:', err && err.message ? err.message : err);
          }
        }
      }
    } finally {
      this.flushing = false;
      this.stats.written += written;
      if (this.queue.length) this.scheduleFlush();
    }
    return { written };
  }

  /** Delete history older than the retention window (called on day rollover). */
  prune() {
    if (!this.enabled) return { kept: [], removed: [], failed: [] };
    return pruneOldLogs(this.dir, { now: this.now, retentionDays: this.retentionDays, fs: this.fs });
  }

  /** Version / path / session facts behind 「一键复制诊断信息」. */
  describe(extra) {
    return {
      version: this.version,
      logDir: this.dir,
      logPath: this.enabled ? this.currentFilePath() : null,
      retentionDays: this.retentionDays,
      sessionStart: this.sessionStart.toISOString(),
      ...(extra || {})
    };
  }
}

function createDiagnosticLogger(options) {
  return new DiagnosticLogger(options);
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  LEVELS,
  REDACTED_KEYS,
  createDiagnosticLogger,
  DiagnosticLogger,
  dateKey,
  daysBetween,
  formatEntry,
  logFileName,
  parseLogDate,
  pruneOldLogs,
  sanitizeDetail
};
