'use strict';

/**
 * R11 (v2.2) — 时间轴总览（minimap）桶聚合，纯模块无 Electron 依赖。
 *
 * 对应 PLAN-v2.2 §R11：桶聚合在主进程计算，IPC 只传桶数组；
 * 上限 ~2000 桶，且不复制帧数据（复用主进程 messageStore 的帧数组）。
 *
 * O(n) 单遍扫描：
 *   - total 桶：全时间跨度内的帧密度（热条总数）
 *   - perId 桶：出现次数最多的 topN 个 ID 各自的密度（用于分类堆叠热条）
 */

const DEFAULT_BUCKETS = 2000;
const DEFAULT_TOP_IDS = 6;

/**
 * @param {object[]} frames 报文帧数组（按时间升序，来自 messageStore）
 * @param {{bucketCount?: number, topN?: number}} [options]
 * @returns {{
 *   bucketCount: number, total: number, tStart: number, tEnd: number,
 *   maxCount: number, buckets: number[],
 *   topIds: number[], perId: Array<{id: number, counts: number[]}>
 * }}
 */
function buildTimelineBuckets(frames, options = {}) {
  const total = Array.isArray(frames) ? frames.length : 0;
  const requested = Number(options.bucketCount) > 0
    ? Math.floor(Number(options.bucketCount))
    : DEFAULT_BUCKETS;
  const topN = Number(options.topN) > 0 ? Math.floor(Number(options.topN)) : DEFAULT_TOP_IDS;

  if (total === 0) {
    return {
      bucketCount: 0, total: 0, tStart: 0, tEnd: 0, maxCount: 0,
      buckets: [], topIds: [], perId: []
    };
  }

  const tStart = Number(frames[0].timestamp) || 0;
  const tEnd = Number(frames[total - 1].timestamp) || 0;
  const span = tEnd - tStart;
  const bucketCount = Math.max(1, Math.min(requested, total));

  const buckets = new Array(bucketCount).fill(0);
  const bucketOf = new Int32Array(total);
  const idCounts = new Map();

  for (let i = 0; i < total; i++) {
    const f = frames[i];
    const t = Number(f.timestamp) || 0;
    let b = span > 0 ? Math.floor(((t - tStart) / span) * bucketCount) : 0;
    if (b < 0) b = 0;
    else if (b >= bucketCount) b = bucketCount - 1;
    bucketOf[i] = b;
    buckets[b]++;

    const id = Number(f.id);
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }

  let maxCount = 0;
  for (let i = 0; i < bucketCount; i++) {
    if (buckets[i] > maxCount) maxCount = buckets[i];
  }

  const topIds = [...idCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
    .slice(0, topN)
    .map((e) => e[0]);

  const slot = new Map(topIds.map((id, i) => [id, i]));
  const perIdCounts = topIds.map(() => new Array(bucketCount).fill(0));
  for (let i = 0; i < total; i++) {
    const s = slot.get(Number(frames[i].id));
    if (s !== undefined) perIdCounts[s][bucketOf[i]]++;
  }

  return {
    bucketCount,
    total,
    tStart,
    tEnd,
    maxCount,
    buckets,
    topIds,
    perId: topIds.map((id, i) => ({ id, counts: perIdCounts[i] }))
  };
}

module.exports = { buildTimelineBuckets, DEFAULT_BUCKETS, DEFAULT_TOP_IDS };
