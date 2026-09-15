import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_RETENTION_DAYS,
  createDiagnosticLogger,
  dateKey,
  daysBetween,
  formatEntry,
  logFileName,
  parseLogDate,
  pruneOldLogs,
  sanitizeDetail
} from '../diagLog';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claproj-diag-'));
}

function at(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h, 0, 0, 0);
}

describe('R14 diagLog helpers', () => {
  it('builds and parses the daily file name', () => {
    expect(dateKey(at(2026, 9, 15))).toBe('2026-09-15');
    expect(logFileName(at(2026, 9, 15))).toBe('app-2026-09-15.log');
    expect(dateKey(parseLogDate('app-2026-09-15.log'))).toBe('2026-09-15');
    expect(parseLogDate('settings.json')).toBeNull();
    expect(daysBetween(at(2026, 9, 7), at(2026, 9, 15))).toBe(8);
  });

  it('sanitizeDetail redacts payload keys, truncates and caps collections', () => {
    const out = sanitizeDetail({
      file: 'a.asc',
      frames: [{ id: 1 }],
      data: [1, 2, 3],
      reason: 'x'.repeat(500),
      list: [1, 2, 3, 4, 5, 6, 7],
      nested: { deep: { deeper: { deepest: { tooDeep: 1 } } } }
    });
    expect(out.frames).toBe('<redacted>');
    expect(out.data).toBe('<redacted>');
    expect(out.reason).toContain('(500 chars)');
    expect(out.reason.length).toBeLessThan(230);
    expect(out.list).toHaveLength(5);
    expect(out.nested.deep.deeper).toBe('[object Object]');
  });

  it('sanitizeDetail keeps the useful parts of an Error', () => {
    const out = sanitizeDetail(new Error('boom'));
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('Error: boom');
  });

  it('formatEntry renders a single grep-friendly line', () => {
    const line = formatEntry({
      ts: new Date(Date.UTC(2026, 8, 15, 4, 5, 6, 789)),
      level: 'error',
      scope: 'renderer',
      event: 'window.onerror',
      detail: { message: 'boom' }
    });
    expect(line).toBe('2026-09-15T04:05:06.789Z ERROR [renderer] window.onerror {"message":"boom"}');
    expect(line).not.toContain('\n');
  });
});

describe('R14 DiagnosticLogger', () => {
  let dir;
  let clock;

  beforeEach(() => {
    dir = makeDir();
    clock = { now: at(2026, 9, 15, 9) };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends one file per day and rolls over at midnight', async () => {
    const logger = createDiagnosticLogger({
      dir,
      version: '2.2.0',
      now: () => clock.now
    });
    logger.info('app.start', { version: '2.2.0' });
    await logger.flush();

    const day1 = path.join(dir, 'app-2026-09-15.log');
    const content1 = fs.readFileSync(day1, 'utf8');
    expect(content1).toContain('INFO [main] app.start');
    expect(content1).toContain('"version":"2.2.0"');
    expect(logger.stats.written).toBe(1);

    // Next day: a new file is used and the previous one is left untouched.
    clock.now = at(2026, 9, 16, 9);
    logger.error('renderer.crash', { reason: 'oom' });
    await logger.flush();
    expect(fs.existsSync(path.join(dir, 'app-2026-09-16.log'))).toBe(true);
    expect(fs.readFileSync(day1, 'utf8')).toBe(content1);
  });

  it('honours the minimum level and never blocks the caller', async () => {
    const logger = createDiagnosticLogger({ dir, minLevel: 'warn', now: () => clock.now });
    expect(logger.log('debug', 'noise')).toBeNull();
    expect(logger.log('info', 'fine')).toBeNull();
    expect(logger.log('warn', 'careful')).toBeTruthy();
    // Nothing is written synchronously — the append happens on the next tick.
    expect(fs.existsSync(path.join(dir, 'app-2026-09-15.log'))).toBe(false);
    await logger.flush();
    expect(fs.readFileSync(path.join(dir, 'app-2026-09-15.log'), 'utf8')).toContain('WARN [main] careful');
  });

  it('is inert when no directory is configured', async () => {
    const logger = createDiagnosticLogger({ dir: null, now: () => clock.now });
    expect(logger.enabled).toBe(false);
    logger.error('boom', {});
    await logger.flush();
    expect(logger.stats.written).toBe(0);
  });

  it('drops entries instead of growing the queue without bound', () => {
    const logger = createDiagnosticLogger({ dir, now: () => clock.now });
    for (let i = 0; i < 5200; i += 1) logger.info('spam', { i });
    expect(logger.stats.dropped).toBeGreaterThan(0);
    expect(logger.queue.length).toBeLessThanOrEqual(5000);
    logger.queue.length = 0; // do not flush 5k entries into the temp dir
  });
});

describe('R14 retention (7 days, fake dates)', () => {
  let dir;

  beforeEach(() => {
    dir = makeDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps today + 7 days and deletes everything older', () => {
    const today = at(2026, 9, 15);
    // Create app-2026-09-05.log … app-2026-09-18.log (10 days back → 3 ahead).
    for (let offset = -10; offset <= 3; offset += 1) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      fs.writeFileSync(path.join(dir, logFileName(d)), `log ${dateKey(d)}\n`);
    }
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}'); // unrelated file

    const result = pruneOldLogs(dir, { now: () => today, retentionDays: DEFAULT_RETENTION_DAYS });

    expect(result.kept).toHaveLength(11); // -7 … +3
    expect(result.removed.sort()).toEqual([
      'app-2026-09-05.log',
      'app-2026-09-06.log',
      'app-2026-09-07.log'
    ]);
    for (const name of result.removed) {
      expect(fs.existsSync(path.join(dir, name))).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, 'app-2026-09-08.log'))).toBe(true); // exactly 7 days old
    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true); // untouched
  });

  it('prunes on the day rollover during logging', async () => {
    const clock = { now: at(2026, 9, 15) };
    for (let offset = -12; offset <= 0; offset += 1) {
      const d = new Date(2026, 8, 15 + offset);
      fs.writeFileSync(path.join(dir, logFileName(d)), 'old\n');
    }
    const logger = createDiagnosticLogger({ dir, now: () => clock.now, retentionDays: 7 });
    clock.now = at(2026, 9, 16); // next day → rollover triggers a prune
    logger.info('app.day-rollover', {});
    await logger.flush();

    const remaining = fs.readdirSync(dir).filter(n => n.startsWith('app-'));
    expect(remaining).not.toContain('app-2026-09-03.log');
    expect(remaining).toContain('app-2026-09-09.log');
    expect(remaining).toContain('app-2026-09-16.log');
  });

  it('survives a missing directory', () => {
    const result = pruneOldLogs(path.join(dir, 'does-not-exist'), { now: () => at(2026, 9, 15) });
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
  });
});
