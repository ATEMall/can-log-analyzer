import { describe, it, expect } from 'vitest';
import { minMaxDownsampleIndices, MAX_RENDER_POINTS } from '../chartDownsample.mjs';

// =====================================================================
// v2.2 R13 — min/max bucket decimation tests.
//
// The point of the rework (PM review on #15): an equal-step sampler loses
// transient spikes. Every test below pins that guarantee — a spike at an
// arbitrary index must survive decimation, and the old step sampler is
// proven (regression guard) to have dropped it.
// =====================================================================

const rowsWith = (n, fn) =>
  Array.from({ length: n }, (_, i) => ({ t: i * 0.01, signals: fn(i) }));

// The sampler this rework replaced: keep every `ceil(n / maxPoints)`-th row.
function equalStepIndices(n, maxPoints) {
  const step = Math.ceil(n / maxPoints);
  const out = [];
  for (let i = 0; i < n; i += step) out.push(i);
  return out;
}

describe('minMaxDownsampleIndices', () => {
  it('returns every row unchanged when the series already fits the budget', () => {
    const rows = rowsWith(120, (i) => ({ a: i }));
    const idx = minMaxDownsampleIndices(rows, ['a'], 5000);
    expect(idx).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it('returns [] for an empty series', () => {
    expect(minMaxDownsampleIndices([], ['a'])).toEqual([]);
    expect(minMaxDownsampleIndices(null, ['a'])).toEqual([]);
  });

  it('keeps a single large spike that equal-step sampling drops', () => {
    const n = 20000;
    const SPIKE = 12345;
    const rows = rowsWith(n, (i) => ({ a: i === SPIKE ? 9999 : 1 }));

    const idx = minMaxDownsampleIndices(rows, ['a'], 100);
    expect(idx).toContain(SPIKE);
    expect(Math.max(...idx.map(i => rows[i].signals.a))).toBe(9999);

    // Regression guard: the previous equal-step sampler misses the spike.
    expect(equalStepIndices(n, 100)).not.toContain(SPIKE);
  });

  it('keeps a single negative (minimum) spike too', () => {
    const n = 30000;
    const DIP = 777;
    const rows = rowsWith(n, (i) => ({ a: i === DIP ? -9999 : 5 }));
    const idx = minMaxDownsampleIndices(rows, ['a'], 200);
    expect(idx).toContain(DIP);
    expect(Math.min(...idx.map(i => rows[i].signals.a))).toBe(-9999);
  });

  it('preserves each signal independently (peaks at different indices)', () => {
    const n = 20000;
    const A_PEAK = 1000;
    const B_PEAK = 7000;
    const rows = rowsWith(n, (i) => ({
      a: i === A_PEAK ? 500 : 0,
      b: i === B_PEAK ? -500 : 0
    }));
    const idx = minMaxDownsampleIndices(rows, ['a', 'b'], 100);
    expect(idx).toContain(A_PEAK);
    expect(idx).toContain(B_PEAK);
  });

  it('never emits more than the render budget', () => {
    const shapes = [
      { n: 6000, keys: ['a'] },
      { n: 12000, keys: ['a', 'b', 'c'] },
      { n: 100000, keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
      { n: 1000000, keys: ['a', 'b', 'c'] }
    ];
    for (const { n, keys } of shapes) {
      const rows = rowsWith(n, (i) => {
        const s = {};
        for (let k = 0; k < keys.length; k++) s[keys[k]] = Math.sin((i + k) / 37) * 10;
        return s;
      });
      const idx = minMaxDownsampleIndices(rows, keys, MAX_RENDER_POINTS);
      expect(idx.length).toBeLessThanOrEqual(MAX_RENDER_POINTS);
      expect(idx.length).toBeGreaterThan(0);
    }
  });

  it('returns ascending, de-duplicated indices (time order preserved)', () => {
    const rows = rowsWith(50000, (i) => ({ a: i % 7, b: (i * 13) % 11 }));
    const idx = minMaxDownsampleIndices(rows, ['a', 'b'], 300);
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    }
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('ignores null / NaN / non-numeric samples when picking extremes', () => {
    const rows = rowsWith(9000, (i) => ({ a: i === 4000 ? null : (i === 5000 ? NaN : 'x') }));
    expect(minMaxDownsampleIndices(rows, ['a'], 50)).toEqual([]);
  });

  it('falls back to the full set when no signal keys are given', () => {
    const rows = rowsWith(9000, (i) => ({ a: i }));
    const idx = minMaxDownsampleIndices(rows, [], 100);
    expect(idx.length).toBe(9000);
  });

  it('retains both the min and max of a ramp that reverses direction', () => {
    const n = 8000;
    // down to -100 at 2000, then up to +100 at 6000
    const rows = rowsWith(n, (i) => ({
      a: i < 2000 ? 100 - i * 0.1 : (i < 6000 ? -100 + (i - 2000) * 0.05 : 100)
    }));
    const idx = minMaxDownsampleIndices(rows, ['a'], 80);
    const vals = idx.map(i => rows[i].signals.a);
    expect(Math.min(...vals)).toBeCloseTo(-100, 5);
    expect(Math.max(...vals)).toBeCloseTo(100, 5);
  });
});
