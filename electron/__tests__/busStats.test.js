import { describe, it, expect } from 'vitest';
import {
  estimateFrameBits,
  buildBusLoad,
  buildCycleStats,
  buildErrorStats,
  DEFAULT_BITRATE
} from '../busStats';

// --- helpers -------------------------------------------------------------

function frame(id, timestamp, bytes = 8, extra = {}) {
  return {
    id,
    timestamp,
    channel: 1,
    direction: 'Rx',
    dlc: bytes,
    data: new Array(bytes).fill(0),
    ...extra
  };
}

/** A strictly periodic message: n frames `periodMs` apart starting at t0. */
function periodic(id, n, periodMs, t0 = 0, bytes = 8, extra = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(frame(id, t0 + (i * periodMs) / 1000, bytes, extra));
  }
  return out;
}

describe('R12 estimateFrameBits', () => {
  it('uses the classic-CAN formula for a standard 8-byte frame (44 + 8*len)', () => {
    expect(estimateFrameBits(frame(0x100, 0, 8))).toBe(108);
  });

  it('adds the extended-frame overhead for 29-bit ids (64 + 8*len)', () => {
    expect(estimateFrameBits(frame(0x18FEF100, 0, 8, { isExtended: true }))).toBe(128);
    // Falls back to the >0x7FF heuristic when the parser did not record the flag.
    expect(estimateFrameBits(frame(0x18FEF100, 0, 8))).toBe(128);
  });

  it('uses the CAN FD formula when the frame is flagged as FD', () => {
    expect(estimateFrameBits(frame(0x100, 0, 64, { isFd: true }))).toBe(67 + 8 * 64);
  });

  it('falls back to dlc when no data bytes are present', () => {
    expect(estimateFrameBits({ id: 0x100, timestamp: 0, dlc: 4 })).toBe(44 + 32);
  });
});

describe('R12 buildBusLoad', () => {
  it('returns an empty series for an empty corpus', () => {
    const load = buildBusLoad([]);
    expect(load.points).toEqual([]);
    expect(load.avg).toBe(0);
    expect(load.peak).toBe(0);
    expect(load.bitrate).toBe(DEFAULT_BITRATE);
  });

  it('aggregates one point per second and reports avg/peak in percent', () => {
    // 10 standard 8-byte frames (108 bits each) inside second 0,
    // 1 frame inside second 1 -> 3 buckets (0s, 1s, 2s).
    const frames = [
      ...periodic(0x100, 10, 0, 0).map((f, i) => frame(0x100, i * 0.05)),
      frame(0x100, 1.2),
      frame(0x100, 2.0)
    ];
    const load = buildBusLoad(frames, { bitrate: 500000 });
    expect(load.interval).toBe(1);
    expect(load.points).toHaveLength(3);
    expect(load.points[0].frames).toBe(10);
    expect(load.points[1].frames).toBe(1);

    // 10 * 108 bits / (500000 bit/s * 1 s) = 0.216 %
    expect(load.peak).toBeCloseTo((10 * 108 / 500000) * 100, 6);
    expect(load.peakTime).toBeCloseTo(0, 6);
    // Average over the covered span (2 s): 12 frames * 108 bits / (500k * 2)
    expect(load.avg).toBeCloseTo((12 * 108 / (500000 * 2)) * 100, 6);
    expect(load.totalBits).toBe(12 * 108);
  });

  it('widens the bucket interval so long logs stay under maxPoints', () => {
    // 10 000 seconds of log with 1 frame/s -> interval 5 s (10000/2000).
    const frames = [];
    for (let i = 0; i < 10000; i++) frames.push(frame(0x100, i));
    const load = buildBusLoad(frames, { bitrate: 500000, maxPoints: 2000 });
    expect(load.interval).toBe(5);
    expect(load.points.length).toBe(2000);
  });

  it('honours a custom bitrate (1 Mbit/s halves the load)', () => {
    const frames = periodic(0x100, 10, 10);
    const at500k = buildBusLoad(frames, { bitrate: 500000 });
    const at1m = buildBusLoad(frames, { bitrate: 1000000 });
    expect(at1m.peak).toBeCloseTo(at500k.peak / 2, 6);
  });
});

describe('R12 buildCycleStats', () => {
  it('computes the mean period from consecutive frames', () => {
    // 5 frames 10 ms apart -> 4 gaps, mean 10 ms.
    const stats = buildCycleStats(periodic(0x100, 5, 10), []);
    expect(stats.totalIds).toBe(1);
    expect(stats.rows).toHaveLength(1);
    const row = stats.rows[0];
    expect(row.count).toBe(5);
    expect(row.avgPeriod).toBeCloseTo(10, 6);
    expect(row.minPeriod).toBeCloseTo(10, 6);
    expect(row.maxPeriod).toBeCloseTo(10, 6);
    expect(row.expected).toBeNull();
    expect(row.firstIndex).toBe(0);
    expect(row.maxJitter).toBeCloseTo(0, 6);
    expect(row.overCount).toBe(0);
  });

  it('measures jitter against the DBC GenMsgCycleTime when present', () => {
    // DBC says 10 ms; the real gaps are 10 / 12 / 8 / 10 ms.
    const frames = [0, 10, 22, 30, 40].map(t => frame(0x100, t / 1000));
    const dbc = [{ id: 0x100, name: 'MsgA', cycleTime: 10, signals: [] }];
    const stats = buildCycleStats(frames, dbc);
    const row = stats.rows[0];
    expect(row.expected).toBe(10);
    expect(row.avgPeriod).toBeCloseTo(10, 6);
    // max |delta - 10| = 2 ms, mean |dev| = (0 + 2 + 2 + 0) / 4 = 1 ms
    expect(row.maxJitter).toBeCloseTo(2, 6);
    expect(row.avgJitter).toBeCloseTo(1, 6);
    // tolerance = max(10 * 10%, 0.05) = 1 ms -> the two 2 ms deviations are over.
    expect(row.overCount).toBe(2);
    expect(row.overRatio).toBeCloseTo(0.5, 6);
  });

  it('falls back to the measured mean when the DBC has no cycle time', () => {
    const frames = [0, 20, 40].map(t => frame(0x200, t / 1000));
    const stats = buildCycleStats(frames, [{ id: 0x200, name: 'MsgB', signals: [] }]);
    expect(stats.rows[0].expected).toBeNull();
    expect(stats.rows[0].avgPeriod).toBeCloseTo(20, 6);
    expect(stats.rows[0].maxJitter).toBeCloseTo(0, 6);
  });

  it('keeps a single-frame id and sorts rows by frame count', () => {
    const frames = [
      ...periodic(0x300, 1, 10),
      ...periodic(0x100, 6, 10),
      ...periodic(0x200, 3, 10)
    ];
    const stats = buildCycleStats(frames, []);
    expect(stats.rows.map(r => r.id)).toEqual([0x100, 0x200, 0x300]);
    expect(stats.rows[2].count).toBe(1);
    expect(stats.rows[2].avgPeriod).toBe(0);
  });

  it('records the absolute index of the first frame of each id', () => {
    const frames = [
      frame(0x100, 0),
      frame(0x200, 0.01),
      frame(0x200, 0.02),
      frame(0x100, 0.03)
    ];
    const stats = buildCycleStats(frames, []);
    const byId = Object.fromEntries(stats.rows.map(r => [r.id, r.firstIndex]));
    expect(byId[0x100]).toBe(0);
    expect(byId[0x200]).toBe(1);
  });

  it('caps the row count and keeps the tolerance in the payload', () => {
    const frames = [];
    for (let id = 0; id < 10; id++) frames.push(...periodic(0x100 + id, 3, 10));
    const stats = buildCycleStats(frames, [], { maxRows: 4, tolerancePct: 25 });
    expect(stats.rows).toHaveLength(4);
    expect(stats.totalIds).toBe(10);
    expect(stats.tolerancePct).toBe(25);
  });
});

describe('R12 buildErrorStats', () => {
  it('counts error frames per category and orders them by time', () => {
    const events = [
      { timestamp: 2.0, channel: 1, kind: 'error-frame', category: 'form' },
      { timestamp: 1.0, channel: 1, kind: 'error-frame', category: 'stuff' },
      { timestamp: 1.5, channel: 1, kind: 'error-frame', category: 'stuff' }
    ];
    const stats = buildErrorStats(events);
    expect(stats.total).toBe(3);
    expect(stats.byKind).toEqual([
      { kind: 'stuff', count: 2 },
      { kind: 'form', count: 1 }
    ]);
    expect(stats.events.map(e => e.timestamp)).toEqual([1.0, 1.5, 2.0]);
    expect(stats.firstError.category).toBe('stuff');
  });

  it('separates bus-state events and counts Bus Off occurrences', () => {
    const events = [
      { timestamp: 0.5, kind: 'bus-state', state: 'error-active', channel: 1 },
      { timestamp: 1.5, kind: 'bus-state', state: 'error-passive', channel: 1 },
      { timestamp: 2.5, kind: 'bus-state', state: 'bus-off', channel: 1 },
      { timestamp: 3.5, kind: 'bus-state', state: 'bus-off', channel: 1 },
      { timestamp: 4.0, kind: 'error-frame', category: 'ack', channel: 1 }
    ];
    const stats = buildErrorStats(events);
    expect(stats.total).toBe(1);          // only real error frames
    expect(stats.busOffCount).toBe(2);
    expect(stats.states).toHaveLength(4);
    expect(stats.lastState.state).toBe('bus-off');
  });

  it('is safe with no events at all', () => {
    const stats = buildErrorStats();
    expect(stats.total).toBe(0);
    expect(stats.byKind).toEqual([]);
    expect(stats.states).toEqual([]);
    expect(stats.busOffCount).toBe(0);
    expect(stats.firstError).toBeNull();
  });

  it('caps the returned timeline events', () => {
    const events = [];
    for (let i = 0; i < 800; i++) {
      events.push({ timestamp: i * 0.001, kind: 'error-frame', category: 'other', channel: 1 });
    }
    const stats = buildErrorStats(events, { maxEvents: 100 });
    expect(stats.total).toBe(800);
    expect(stats.events).toHaveLength(100);
  });
});
