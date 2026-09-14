// R11 / Issue #16: 时间轴总览桶聚合（~2000 桶，主进程 O(n) 单遍）。
import { describe, it, expect } from 'vitest';
import { buildTimelineBuckets, DEFAULT_BUCKETS } from '../timelineBuckets.js';

function frames() {
  const out = [];
  // 0..99s，每 0.1s 一帧，ID 交替 0x100 / 0x200，0x100 出现两倍频次。
  for (let i = 0; i < 1000; i++) {
    out.push({ id: i % 3 === 0 ? 0x200 : 0x100, timestamp: i * 0.1 });
  }
  return out;
}

describe('timelineBuckets.buildTimelineBuckets', () => {
  it('clamps the bucket count and conserves the frame total', () => {
    const r = buildTimelineBuckets(frames(), { bucketCount: 2000 });
    // 帧数少于请求桶数时按帧数收敛，避免空桶。
    expect(r.bucketCount).toBe(1000);
    expect(r.total).toBe(1000);
    const sum = r.buckets.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1000);
  });

  it('keeps the time span and a non-zero max density', () => {
    const r = buildTimelineBuckets(frames(), { bucketCount: 100 });
    expect(r.tStart).toBe(0);
    expect(r.tEnd).toBeCloseTo(99.9, 6);
    expect(r.bucketCount).toBe(100);
    expect(r.maxCount).toBeGreaterThan(0);
    expect(Math.max(...r.buckets)).toBe(r.maxCount);
  });

  it('produces per-ID density arrays that sum to each ID total', () => {
    const list = frames();
    const r = buildTimelineBuckets(list, { bucketCount: 100, topN: 2 });
    expect(r.topIds).toEqual([0x100, 0x200]);
    expect(r.perId).toHaveLength(2);

    const expected = new Map();
    for (const f of list) expected.set(f.id, (expected.get(f.id) || 0) + 1);

    for (const entry of r.perId) {
      const sum = entry.counts.reduce((a, b) => a + b, 0);
      expect(sum).toBe(expected.get(entry.id));
      expect(entry.counts).toHaveLength(r.bucketCount);
    }
  });

  it('samples density consistently with the raw distribution', () => {
    const list = frames();
    const r = buildTimelineBuckets(list, { bucketCount: 10 });
    // 前 1/10 时间窗（0..9.9s）应包含 100 帧。
    expect(r.buckets[0]).toBe(100);
    expect(r.buckets[9]).toBe(100);
  });

  it('handles an empty corpus', () => {
    const r = buildTimelineBuckets([]);
    expect(r.total).toBe(0);
    expect(r.buckets).toEqual([]);
    expect(r.maxCount).toBe(0);
  });

  it('uses the 2000-bucket default', () => {
    const many = [];
    for (let i = 0; i < 3000; i++) many.push({ id: 0x100, timestamp: i });
    const r = buildTimelineBuckets(many);
    expect(r.bucketCount).toBe(DEFAULT_BUCKETS);
  });
});
