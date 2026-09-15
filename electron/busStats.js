// =====================================================================
// R12 (v2.2) — 总线统计纯模块：逐秒负载率 / 周期与抖动 / 错误帧分类
//
// 设计要点：
//   - 纯函数、无 electron 依赖，可直接在 vitest 中单测。
//   - 负载：O(n) 单遍桶聚合（桶间隔自适应，默认 ≤2000 点）。
//   - 周期/抖动：O(n) 两遍，第一遍求跨度/首帧下标，第二遍求相邻帧间隔
//     统计；不缓存每帧时间戳，1M 帧内存开销为 O(唯一 ID 数)。
//   - 参考周期优先取 DBC `GenMsgCycleTime`（BA_ 属性，dbc.js 解析为
//     msg.cycleTime），缺失时退化为实测均值。
//   - 错误帧：只做分类计数与时间线切片，不修改任何解码路径。
// =====================================================================

const DEFAULT_BITRATE = 500000;      // 500 kbit/s（Classic CAN 常用）
const DEFAULT_MAX_POINTS = 2000;     // 负载曲线最大点数
const DEFAULT_TOLERANCE_PCT = 10;    // 周期超差判定：±10%
const DEFAULT_MAX_ROWS = 200;        // 周期表最大行数（按帧数排序）
const DEFAULT_MAX_EVENTS = 500;      // 错误/状态事件时间线最大条数

// 帧位长经验估算（含位填充与帧间隔的常用近似，Vector CANoe 口径）：
//   标准帧 11-bit ID：44 + 8*len
//   扩展帧 29-bit ID：64 + 8*len
//   CAN FD         ：67 + 8*len
function dataLength(frame) {
  if (!frame) return 0;
  if (Array.isArray(frame.data) && frame.data.length > 0) return frame.data.length;
  const dlc = Number(frame.dlc) || 0;
  return dlc;
}

function isExtendedFrame(frame) {
  if (!frame) return false;
  if (frame.isExtended !== undefined && frame.isExtended !== null) return !!frame.isExtended;
  return Number(frame.id) > 0x7FF;
}

function estimateFrameBits(frame) {
  if (!frame) return 0;
  const len = dataLength(frame);
  if (frame.isFd) return 67 + 8 * len;
  return (isExtendedFrame(frame) ? 64 : 44) + 8 * len;
}

function toTimestamp(frame) {
  const t = Number(frame && frame.timestamp);
  return Number.isFinite(t) ? t : 0;
}

/**
 * 逐秒总线负载率（%）。
 * 桶间隔自适应：span / maxPoints 向上取整到整秒，保证长日志的曲线点数
 * 不超过 maxPoints（IPC 只回传点数级数据）。
 */
function buildBusLoad(frames, options) {
  const opts = options || {};
  const bitrate = Number(opts.bitrate) > 0 ? Number(opts.bitrate) : DEFAULT_BITRATE;
  const maxPoints = Number(opts.maxPoints) > 0 ? Number(opts.maxPoints) : DEFAULT_MAX_POINTS;
  const empty = {
    bitrate,
    tStart: 0,
    tEnd: 0,
    interval: 1,
    duration: 0,
    totalFrames: 0,
    totalBits: 0,
    avg: 0,
    peak: 0,
    peakTime: 0,
    points: []
  };
  if (!Array.isArray(frames) || frames.length === 0) return empty;

  // Pass 1: span（日志时间戳可能并非严格递增，取真实 min/max）。
  let tStart = Infinity;
  let tEnd = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const t = toTimestamp(frames[i]);
    if (t < tStart) tStart = t;
    if (t > tEnd) tEnd = t;
  }
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) return empty;

  const span = Math.max(0, tEnd - tStart);
  const interval = Math.max(1, Math.ceil(span / maxPoints)); // 秒
  const n = Math.floor(span / interval) + 1;
  const bits = new Float64Array(n);
  const counts = new Int32Array(n);
  let totalBits = 0;

  // Pass 2: 位计数 + 帧计数（O(n)）。
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const t = toTimestamp(f);
    const idx = Math.min(n - 1, Math.max(0, Math.floor((t - tStart) / interval)));
    bits[idx] += estimateFrameBits(f);
    counts[idx] += 1;
    totalBits += estimateFrameBits(f);
  }

  const points = [];
  let peak = 0;
  let peakTime = tStart;
  let peakFrames = 0;
  for (let i = 0; i < n; i++) {
    const load = (bits[i] / (bitrate * interval)) * 100;
    points.push({ t: tStart + i * interval, load, frames: counts[i] });
    if (load > peak) {
      peak = load;
      peakTime = tStart + i * interval;
      peakFrames = counts[i];
    }
  }

  // 平均负载按实际覆盖时长归一（跨度不足一个桶时按一个桶计）。
  const avg = (totalBits / (bitrate * Math.max(span, interval))) * 100;

  return {
    bitrate,
    tStart,
    tEnd,
    interval,
    duration: span,
    totalFrames: frames.length,
    totalBits,
    avg,
    peak,
    peakTime,
    peakFrames,
    points
  };
}

/**
 * 按消息 ID 的周期与抖动统计。
 * jitter = 实测周期 − 参考周期（DBC GenMsgCycleTime，缺失时用实测均值）。
 * 超差：|实测周期 − 参考周期| > max(参考周期 * tolerancePct%, 0.05ms)。
 */
function buildCycleStats(frames, dbcMessages, options) {
  const opts = options || {};
  const tolerancePct = Number(opts.tolerancePct) > 0 ? Number(opts.tolerancePct) : DEFAULT_TOLERANCE_PCT;
  const maxRows = Number(opts.maxRows) > 0 ? Number(opts.maxRows) : DEFAULT_MAX_ROWS;
  const list = Array.isArray(dbcMessages) ? dbcMessages : [];

  const nameById = new Map();
  const cycleById = new Map();
  for (const m of list) {
    const id = Number(m && m.id);
    if (!Number.isFinite(id)) continue;
    if (m.name) nameById.set(id, m.name);
    if (m.cycleTime !== undefined && m.cycleTime !== null && Number.isFinite(Number(m.cycleTime))) {
      cycleById.set(id, Number(m.cycleTime));
    }
  }

  const empty = { tolerancePct, totalIds: 0, rows: [] };
  if (!Array.isArray(frames) || frames.length === 0) return empty;

  // Pass 1: 每个 ID 的帧数 / 首末时间戳 / 首帧下标。
  const meta = new Map();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const id = Number(f && f.id) || 0;
    const t = toTimestamp(f);
    let m = meta.get(id);
    if (!m) {
      m = { id, count: 0, first: t, last: t, firstIndex: i };
      meta.set(id, m);
    }
    m.count += 1;
    if (t < m.first) m.first = t;
    if (t > m.last) m.last = t;
    if (i < m.firstIndex) m.firstIndex = i;
  }

  // 参考周期（ms）：DBC 优先，否则实测均值。
  const refMs = new Map();
  for (const m of meta.values()) {
    const gaps = m.count - 1;
    const measured = gaps > 0 ? ((m.last - m.first) / gaps) * 1000 : 0;
    const dbcCycle = cycleById.get(m.id);
    refMs.set(m.id, { ref: dbcCycle !== undefined ? dbcCycle : measured, measured, fromDbc: dbcCycle !== undefined });
  }

  // Pass 2: 相邻帧间隔 -> 抖动 / 超差（O(n)，不保存逐帧 delta）。
  const prevTs = new Map();
  const agg = new Map(); // id -> { sum, min, max, maxDev, sumDev, over, n }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const id = Number(f && f.id) || 0;
    const t = toTimestamp(f);
    const prev = prevTs.get(id);
    prevTs.set(id, t);
    if (prev === undefined) continue;

    const deltaMs = Math.abs(t - prev) * 1000;
    const ref = (refMs.get(id) || { ref: 0 }).ref;
    const dev = deltaMs - ref;
    const absDev = Math.abs(dev);
    const tol = Math.max((ref * tolerancePct) / 100, 0.05);

    let a = agg.get(id);
    if (!a) {
      a = { sum: 0, min: deltaMs, max: deltaMs, maxDev: 0, sumDev: 0, over: 0, n: 0 };
      agg.set(id, a);
    }
    a.sum += deltaMs;
    a.n += 1;
    if (deltaMs < a.min) a.min = deltaMs;
    if (deltaMs > a.max) a.max = deltaMs;
    if (absDev > a.maxDev) a.maxDev = absDev;
    a.sumDev += absDev;
    if (absDev > tol) a.over += 1;
  }

  const rows = [];
  for (const m of meta.values()) {
    const a = agg.get(m.id);
    const refInfo = refMs.get(m.id) || { ref: 0, measured: 0, fromDbc: false };
    const n = a ? a.n : 0;
    rows.push({
      id: m.id,
      name: nameById.get(m.id) || '',
      count: m.count,
      firstIndex: m.firstIndex,
      expected: refInfo.fromDbc ? refInfo.ref : null,
      avgPeriod: a ? a.sum / n : 0,
      minPeriod: a ? a.min : 0,
      maxPeriod: a ? a.max : 0,
      maxJitter: a ? a.maxDev : 0,
      avgJitter: a ? a.sumDev / n : 0,
      overCount: a ? a.over : 0,
      overRatio: n > 0 && a ? a.over / n : 0
    });
  }

  rows.sort((x, y) => y.count - x.count || x.id - y.id);

  return { tolerancePct, totalIds: meta.size, rows: rows.slice(0, maxRows) };
}

/**
 * 错误帧 / 总线状态统计。
 * 输入事件由 ASC 解析（`parseASCErrorLine`）与 BLF 解析产生：
 *   { timestamp, channel, kind: 'error-frame'|'bus-state', category, state, text }
 */
function buildErrorStats(events, options) {
  const opts = options || {};
  const maxEvents = Number(opts.maxEvents) > 0 ? Number(opts.maxEvents) : DEFAULT_MAX_EVENTS;
  const list = Array.isArray(events) ? events : [];

  const frames = [];
  const states = [];
  for (const e of list) {
    if (!e) continue;
    if (e.state) states.push(e);
    else frames.push(e);
  }
  const byTime = (a, b) => toTimestamp(a) - toTimestamp(b);
  frames.sort(byTime);
  states.sort(byTime);

  const kindCounts = new Map();
  for (const e of frames) {
    const key = e.category || 'other';
    kindCounts.set(key, (kindCounts.get(key) || 0) + 1);
  }
  const byKind = Array.from(kindCounts.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  const busOff = states.filter(s => s.state === 'bus-off');

  return {
    total: frames.length,
    byKind,
    events: frames.slice(0, maxEvents),
    states: states.slice(0, maxEvents),
    busOffCount: busOff.length,
    firstError: frames.length > 0 ? frames[0] : null,
    lastState: states.length > 0 ? states[states.length - 1] : null
  };
}

module.exports = {
  DEFAULT_BITRATE,
  DEFAULT_MAX_POINTS,
  DEFAULT_TOLERANCE_PCT,
  dataLength,
  estimateFrameBits,
  buildBusLoad,
  buildCycleStats,
  buildErrorStats
};
