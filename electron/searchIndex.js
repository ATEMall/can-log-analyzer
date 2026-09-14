'use strict';

/**
 * R11 (v2.2) — 全局搜索索引（纯模块，无 Electron 依赖，便于单测）。
 *
 * 设计要点（对应 PLAN-v2.2 §R11 技术约束）：
 *  - 报文帧只做一次 O(n) 单遍扫描，落成 "ID -> {count, firstIndex, firstTimestamp}"
 *    的稀疏索引；1M 帧约数十毫秒，索引由主进程按文件路径缓存，日志不变不重建。
 *  - DBC 结构与信号名规模很小（百级），每次查询即时遍历即可，无需缓存。
 *  - 查询语义统一：
 *      数字类（`123` / `0x7B` / `7B`）  -> 精确匹配 CAN ID（十进制与十六进制两种解释）
 *      文本类（消息名 / 信号名 / DID）-> 大小写不敏感的包含匹配
 *    两类结果取并集，因此 `F190` 既能命中 DID_ 命名的信号，也能命中 0xF190 报文。
 *  - scope === 'dbc' 时只检索 DBC 结构（"当前视图"），不扫描报文帧。
 *
 * 返回结构保持 IPC 可序列化（纯数组 / 纯对象 / 基本类型）。
 */

const HEX_PREFIX = /^0x[0-9a-f]+$/i;
const DEC_ONLY = /^[0-9]+$/;
const BARE_HEX = /^[0-9a-f]+$/i;

/**
 * 把查询串解析为可能的 CAN ID。
 * 返回候选 ID 数组（可能为空，也可能同时含十进制/十六进制两种解释）。
 */
function parseIdQuery(raw) {
  const q = String(raw == null ? '' : raw).trim();
  if (!q) return [];
  if (HEX_PREFIX.test(q)) {
    const v = parseInt(q.slice(2), 16);
    return Number.isFinite(v) ? [v] : [];
  }
  if (DEC_ONLY.test(q)) {
    const v = parseInt(q, 10);
    const out = Number.isFinite(v) ? [v] : [];
    // 纯数字也可能是省略 0x 的十六进制（如 "123"），两种解释都作为候选。
    if (/[2-9]/.test(q)) {
      const h = parseInt(q, 16);
      if (Number.isFinite(h) && !out.includes(h)) out.push(h);
    }
    return out;
  }
  if (BARE_HEX.test(q) && /[a-f]/i.test(q)) {
    const v = parseInt(q, 16);
    return Number.isFinite(v) ? [v] : [];
  }
  return [];
}

/** 单遍扫描报文帧，建立 ID -> 帧统计 的稀疏索引。 */
function buildFrameIndex(frames) {
  const byId = new Map();
  const total = Array.isArray(frames) ? frames.length : 0;
  for (let i = 0; i < total; i++) {
    const f = frames[i];
    const id = Number(f && f.id);
    if (!Number.isFinite(id)) continue;
    const entry = byId.get(id);
    if (entry) {
      entry.count++;
    } else {
      byId.set(id, { id, count: 1, firstIndex: i, firstTimestamp: Number(f.timestamp) || 0 });
    }
  }
  return { byId, total };
}

/** DBC 结构索引：消息名 + 信号名，按消息聚合。 */
function buildDbcIndex(dbcMessages) {
  const entries = [];
  for (const msg of dbcMessages || []) {
    if (!msg) continue;
    const signals = [];
    for (const sig of msg.signals || []) {
      if (sig && sig.name) signals.push(sig.name);
    }
    entries.push({
      id: Number(msg.id),
      name: msg.name || '',
      signals
    });
  }
  return { entries };
}

function emptyResult(query) {
  return {
    query: String(query == null ? '' : query).trim(),
    kind: 'empty',
    matchCount: 0,
    matchedIds: [],
    firstIndex: null,
    firstTimestamp: null,
    frameMatches: [],
    nameMatches: []
  };
}

/**
 * 执行一次搜索。
 *
 * @param {{byId: Map, total: number}|null} frameIndex buildFrameIndex 的产物，可为 null（无日志）
 * @param {object[]} dbcMessages 已解析的 DBC 消息定义
 * @param {string} rawQuery 用户输入
 * @param {{scope?: 'all'|'dbc'}} [options]
 */
function searchFrames(frameIndex, dbcMessages, rawQuery, options = {}) {
  const query = String(rawQuery == null ? '' : rawQuery).trim();
  if (!query) return emptyResult(query);

  const scope = options.scope === 'dbc' ? 'dbc' : 'all';
  const qLower = query.toLowerCase();
  const idCandidates = scope === 'all' ? parseIdQuery(query) : [];

  const matchedIds = new Set();
  const frameMatches = [];
  const nameMatches = [];

  // 1) DBC 名称/信号/DID 文本匹配
  for (const entry of buildDbcIndex(dbcMessages).entries) {
    const signals = entry.signals.filter(
      (name) => String(name).toLowerCase().includes(qLower)
    );
    const nameHit = String(entry.name).toLowerCase().includes(qLower);
    if (nameHit || signals.length > 0) {
      nameMatches.push({
        msgId: entry.id,
        msgName: entry.name,
        signals: signals.slice(0, 20)
      });
      if (Number.isFinite(entry.id)) matchedIds.add(entry.id);
    }
  }

  // 2) ID 精确匹配（十进制 + 十六进制两种解释）
  let idHit = false;
  if (idCandidates.length > 0 && frameIndex) {
    for (const cand of idCandidates) {
      if (frameIndex.byId.has(cand)) {
        matchedIds.add(cand);
        idHit = true;
      }
    }
  }

  // "当前视图"（scope = dbc）：只统计结构命中，不扫描报文帧，也不定位。
  if (scope === 'dbc') {
    const hasName = nameMatches.length > 0;
    return {
      query,
      kind: hasName ? 'name' : 'none',
      matchCount: nameMatches.length,
      matchedIds: [...matchedIds].sort((a, b) => a - b),
      firstIndex: null,
      firstTimestamp: null,
      frameMatches: [],
      nameMatches
    };
  }

  // 3) 用索引补齐每个命中 ID 的帧统计
  let matchCount = 0;
  let firstIndex = null;
  let firstTimestamp = null;
  for (const id of matchedIds) {
    const stat = frameIndex ? frameIndex.byId.get(id) : null;
    if (stat) {
      matchCount += stat.count;
      frameMatches.push({ ...stat });
      if (firstIndex === null || stat.firstIndex < firstIndex) {
        firstIndex = stat.firstIndex;
        firstTimestamp = stat.firstTimestamp;
      }
    } else {
      // DBC 命中但日志中没有该 ID 的帧：仅作为结构命中，计入 0 帧。
      frameMatches.push({ id, count: 0, firstIndex: null, firstTimestamp: null });
    }
  }
  frameMatches.sort((a, b) => {
    if (a.firstIndex === null && b.firstIndex === null) return a.id - b.id;
    if (a.firstIndex === null) return 1;
    if (b.firstIndex === null) return -1;
    return a.firstIndex - b.firstIndex;
  });

  let kind = 'none';
  const hasName = nameMatches.length > 0;
  if (idHit && hasName) kind = 'mixed';
  else if (idHit) kind = 'id';
  else if (hasName) kind = 'name';

  return {
    query,
    kind,
    matchCount,
    matchedIds: [...matchedIds].sort((a, b) => a - b),
    firstIndex,
    firstTimestamp,
    frameMatches,
    nameMatches
  };
}

module.exports = {
  parseIdQuery,
  buildFrameIndex,
  buildDbcIndex,
  searchFrames
};
