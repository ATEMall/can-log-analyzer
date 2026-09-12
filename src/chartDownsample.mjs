// =====================================================================
// v2.2 R13 — waveform-faithful min/max bucket downsampling.
//
// An equal-step sampler ("keep every Nth row") silently drops transient
// spikes that fall between two samples — exactly the intermittent fault
// signature CAN analysis exists to catch. So instead of sampling rows we
// split the series into buckets and, PER SIGNAL AND PER BUCKET, keep the
// argmin and argmax rows. Every instantaneous peak therefore survives
// into the rendered set while the point count stays bounded:
//
//   buckets = clamp(floor(maxPoints / (2 * signals)), 1, n)
//   emitted <= 2 * signals * buckets <= maxPoints
//
// Fewer signals => more buckets => finer time resolution; more signals
// => coarser buckets but every curve still keeps its own extremes.
//
// Indices are returned ascending so the renderer keeps them in time
// order (recharts draws left to right).
// =====================================================================

export const MAX_RENDER_POINTS = 5000;

/**
 * Pick the row indices to render from `rows` using per-signal min/max
 * bucket decimation.
 *
 * @param {Array<{t:number, signals?:Object}>} rows  full-resolution series
 * @param {string[]} keys                            signal keys to preserve
 * @param {number} [maxPoints]                       render budget
 * @returns {number[]} ascending row indices (length <= maxPoints)
 */
export function minMaxDownsampleIndices(rows, keys, maxPoints = MAX_RENDER_POINTS) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n === 0) return [];

  // Small series: draw every row, no decimation needed.
  if (n <= maxPoints) {
    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }

  const keyList = Array.isArray(keys) ? keys : [];
  // Nothing to bucket by -> cannot guarantee peaks, keep the full set.
  if (keyList.length === 0) {
    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }

  const bucketCount = Math.max(1, Math.min(n, Math.floor(maxPoints / (2 * keyList.length))));
  const bucketSize = Math.ceil(n / bucketCount);
  const keep = new Set();

  for (let start = 0; start < n; start += bucketSize) {
    const end = Math.min(n, start + bucketSize);
    for (const key of keyList) {
      let minI = -1;
      let maxI = -1;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = start; i < end; i++) {
        const sig = rows[i] && rows[i].signals;
        const val = sig ? sig[key] : undefined;
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (val < minV) { minV = val; minI = i; }
          if (val > maxV) { maxV = val; maxI = i; }
        }
      }
      if (minI >= 0) keep.add(minI);
      if (maxI >= 0) keep.add(maxI);
    }
  }

  return Array.from(keep).sort((a, b) => a - b);
}
