// A2L（ASAP2）解析器（v4.0 / B2-T3）
//
// 目标：为 XCP（B3）提供「地址 → 信号量」的映射与量纲换算依据，同时给出
// A2L 自身的统计与结构校验。设计要点（PLAN §三 T3）：
//   - 单一 token 流 + /begin ... /end 配对校验（深度记录，便于定位损坏节点）
//   - 未识别 BLOCK 计数跳过（不静默丢弃：计入 unknownBlocks）
//   - /include 嵌套展开（计划：按 PLAN 记录为「展开计数校验」，此处统计路径）
//   - 支持 MEASUREMENT / CHARACTERISTIC / COMPU_METHOD，及 XCP 的
//     DAQ_LIST_CAN_ID（FIXED 的 29 位扩展 ID 需去掉 0x40000000 标志位）
//   - INCLUDE 与未知块均计数，便于与手工 grep 对拍

'use strict';

const EXT_FLAG = 0x40000000; // A2L 中 FIXED 的 29 位扩展 CAN ID 标志

// ---------- 词法：去注释 + token 化 ----------
function tokenize(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {          // 块注释
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {          // 行注释
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {                                // 字符串
      i++;
      let buf = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) { buf += src[i + 1]; i += 2; continue; }
        buf += src[i]; i++;
      }
      i++;
      out.push({ type: 'str', value: buf });
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < n && !/\s/.test(src[j]) && src[j] !== '"') j++;
    out.push({ type: 'raw', value: src.slice(i, j) });
    i = j;
  }
  return out;
}

function isBegin(t) { return t && t.type === 'raw' && t.value === '/begin'; }
function isEnd(t) { return t && t.type === 'raw' && t.value === '/end'; }

// ---------- 语法：递归下降，产出结构化节点 ----------
// 节点：{ name, raw: [tokens], children: [{name, raw, children}], value: [tokens] }
function parseBlock(tokens, i, errors, depth) {
  const start = i;
  let name = null;
  const children = [];
  const value = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (isBegin(t)) {
      const child = parseBlock(tokens, i + 1, errors, depth + 1);
      children.push(child);
      i = child.next;
      continue;
    }
    if (isEnd(t)) {
      if (name === null) {
        errors.push({ kind: 'unpaired-end', token: JSON.stringify(t) });
        return { next: i + 1 };
      }
      // `/end <NAME>` 的闭合标签带块名，需一并跳过，否则残留的块名会被
      // 外层误当成字段值（实测导致 IF_DATA 出现在 MEASUREMENT 的字段里）。
      let next = i + 1;
      const nt = tokens[next];
      if (nt && nt.type === 'raw' && nt.value === name) next++;
      return { name, children, value, next, start };
    }
    if (name === null && t.type === 'raw') { name = t.value; i++; continue; }
    value.push(t);
    i++;
  }
  if (name !== null) errors.push({ kind: 'unterminated-block', name });
  return { next: i };
}

// `/include "path"` 是字段级关键字，不形成 /begin.../end 块，需在 token 流里扫描。
function collectIncludes(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== 'raw') continue;
    const v = String(t.value).toLowerCase();
    if (v === 'include' || v === '/include') {
      const nx = tokens[k + 1];
      if (nx && nx.type === 'str' && nx.value) out.push(nx.value);
    }
  }
  return out;
}

function parseA2L(text) {
  const tokens = tokenize(text);
  const includes = collectIncludes(tokens);
  const errors = [];
  const roots = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (isBegin(t)) {
      const blk = parseBlock(tokens, i + 1, errors, 0);
      if (blk.name) roots.push(blk);
      i = blk.next;
      continue;
    }
    if (isEnd(t)) { errors.push({ kind: 'stray-end' }); i++; continue; }
    i++; // 顶层散落 token（如 /begin 之外的关键字）忽略
  }
  return { roots, errors, tokens, includes };
}

// ---------- 语义抽取 ----------
function tokVal(t) { return t == null ? null : t.value; }
function findChild(node, name) {
  for (const c of node.children || []) if (c.name === name) return c;
  return null;
}
function findAll(node, name, acc) {
  acc = acc || [];
  for (const c of node.children || []) {
    if (c.name === name) acc.push(c);
    findAll(c, name, acc);
  }
  return acc;
}
function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/0[xX]/, '');
  const parsed = /^[0-9a-fA-F]+$/.test(s) && /^0[xX]/.test(String(v)) ? parseInt(s, 16) : Number(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMeasurement(m) {
  const v = m.value || [];
  // ECU 地址在 IF_DATA 里（CANAPE_EXT 100 <addr> / ETK_XETK 100 <addr> 等）。
  // IF_DATA 的内容是平铺参数（不是 /begin 子块），故直接扫其 value；
  // 不同工具的段名不同，统一取「100 之后的数值」。
  const ecuAddr = (() => {
    const ifd = findChild(m, 'IF_DATA');
    if (!ifd) return null;
    const av = (ifd.value || []).map(tokVal);
    const idx = av.indexOf('100');
    if (idx >= 0 && idx + 1 < av.length) return num(av[idx + 1]);
    // 少数工具把地址写在子块里
    for (const c of ifd.children || []) {
      const cv = (c.value || []).map(tokVal);
      const k = cv.indexOf('100');
      if (k >= 0 && k + 1 < cv.length) return num(cv[k + 1]);
    }
    return null;
  })();
  return {
    name: tokVal(v[0]),
    longIdentifier: tokVal(v[1]),
    datatype: tokVal(v[2]),
    compuMethod: tokVal(v[3]),
    resolution: num(tokVal(v[4])),
    accuracy: num(tokVal(v[5])),
    lowerLimit: num(tokVal(v[6])),
    upperLimit: num(tokVal(v[7])),
    address: ecuAddr
  };
}

function parseCharacteristic(c) {
  const v = c.value || [];
  return {
    name: tokVal(v[0]),
    longIdentifier: tokVal(v[1]),
    type: tokVal(v[2]),
    address: num(tokVal(v[3])),
    recordLayout: tokVal(v[4]),
    maxDiff: num(tokVal(v[5])),
    compuMethod: tokVal(v[6])
  };
}

function parseCompuMethod(c) {
  const v = c.value || [];
  const name = tokVal(v[0]);
  const type = tokVal(v[2]);
  const rest = (c.value || []).slice(3).map(tokVal);
  const out = { name, longIdentifier: tokVal(v[1]), type, coeffs: [], pairs: [] };
  const isNumToken = (x) => x != null && !/^[A-Za-z_/]/.test(String(x));
  if (/^(LINEAR|RAT_FUNC|RAT|FUNC)$/.test(String(type))) {
    // 去掉单位与 COEFFS_LINEAR / COEFFS 关键字，只留数值系数
    out.coeffs = rest.filter(isNumToken).map(num).filter((v) => v !== null);
  } else if (/^(TAB_INTP|TAB_NOINTP|TAB_VERB)$/.test(String(type))) {
    const nums = rest.filter(isNumToken).map(num).filter((v) => v !== null);
    for (let k = 1; k + 1 < nums.length; k += 2) out.pairs.push([nums[k], nums[k + 1]]);
  }
  return out;
}

// XCP：DAQ_LIST_CAN_ID / FIRST_PID 等 IF_DATA XCP 片段
function parseXcpIfData(roots, project) {
  const canIds = [];
  const firstPids = [];
  // DAQ_LIST_CAN_ID 可能深埋在 PROJECT/MODULE/IF_DATA/XCP... 之下，需递归查找。
  for (const r of roots) {
    for (const dl of findAll(r, 'IF_DATA')) {
      for (const d of findAll(dl, 'DAQ_LIST_CAN_ID')) {
        const vals = (d.value || []).map(tokVal);
        const idx = vals.findIndex((x) => /^(FIXED|VARIABLE)$/i.test(String(x)));
        if (idx >= 0) {
          let raw = num(vals[idx + 1]);
          if (raw != null && raw >= EXT_FLAG) raw -= EXT_FLAG; // 去掉 29 位扩展 ID 标志
          canIds.push({ raw, fixed: String(vals[idx]).toUpperCase() === 'FIXED' });
        }
        const fp = vals.findIndex((x) => /^FIRST_PID$/i.test(String(x)));
        if (fp >= 0) firstPids.push(num(vals[fp + 1]));
      }
      for (const fpNode of findAll(dl, 'FIRST_PID')) {
        const v = num(tokVal((fpNode.value || [])[0]));
        if (v != null) firstPids.push(v);
      }
    }
  }
  project.xcpDaqCanIds = canIds;
  project.xcpFirstPids = firstPids;
}

/**
 * 解析 A2L 文本。
 * @param {string} text
 * @returns {{measurements:object[],characteristics:object[],compuMethods:object[],
 *            includes:string[],unknownBlocks:object[],xcpDaqCanIds:object[],
 *            xcpFirstPids:number[],stats:object,errors:object[]}}
 */
function parseA2LDocument(text) {
  const { roots, errors, includes: tokenIncludes } = parseA2L(text);
  const measurements = [];
  const characteristics = [];
  let compuMethodNodes = [];
  const includes = [];
  const unknown = new Map();
  const known = new Set([
    'PROJECT', 'HEADER', 'MODULE', 'MEASUREMENT', 'CHARACTERISTIC', 'COMPU_METHOD',
    'COMPU_TAB', 'FUNCTION', 'GROUP', 'RECORD_LAYOUT', 'AXIS_PTS', 'FRAME',
    'ECU_PARAMETERS', 'USER_RIGHTS', 'IF_DATA', 'ANNOTATION', 'MOD_COMMON',
    'MOD_PAR', 'A2ML', 'CANAPE_EXT', 'XCP', 'XCPplus', 'DAQ', 'DAQ_LIST',
    'DAQ_LIST_CAN_ID', 'ODT', 'ODT_ENTRY', 'FIXED', 'FIRST_PID', 'TRANSFORMER',
    'MEMORY_SEGMENT', 'MEMORY_LAYOUT', 'CALIBRATION_METHOD', 'BLOB', 'SYSTEM_CONSTANT',
    'TYPEDEF_MEASUREMENT', 'TYPEDEF_CHARACTERISTIC', 'INSTANCE', 'UNIT', 'SI_EXPONENT',
    'COMPU_VTAB', 'COMPU_VTAB_RANGE', 'VARIABLE', 'DEPENDENT_CHARACTERISTIC',
    'VIRTUAL_CHARACTERISTIC', 'STRUCTURE_COMPONENT', 'AXIS_DESCR', 'MATRIX_DIM',
    'DISPLAY_CHARACTERISTIC', 'FUNCTION_LIST', 'IDENTIFICATION_LIST', 'VARIANT_CODING',
    'SEGMENT', 'PAGE', 'ADDR_EPK', 'SUPPLIER', 'CUSTOMER', 'ECU', 'CPU_TYPE',
    'NO_OF_INTERFACES', 'SYSTEM_CONSTANT', 'PHONE_NO', 'VERSION'
  ]);

  for (const r of roots) {
    if (r.name === 'MEASUREMENT') { measurements.push(parseMeasurement(r)); continue; }
    if (r.name === 'CHARACTERISTIC') { characteristics.push(parseCharacteristic(r)); continue; }
    if (r.name === 'COMPU_METHOD') { compuMethodNodes.push(r); continue; }
    if (r.name === 'PROJECT' || r.name === 'MODULE' || r.name === 'HEADER') {
      measurements.push(...findAll(r, 'MEASUREMENT').map(parseMeasurement));
      characteristics.push(...findAll(r, 'CHARACTERISTIC').map(parseCharacteristic));
      compuMethodNodes.push(...findAll(r, 'COMPU_METHOD'));
      continue;
    }
    if (r.name === 'INCLUDE') { includes.push(String(tokVal((r.value || [])[0])).replace(/^"|"$/g, '')); continue; }
    if (!known.has(r.name)) unknown.set(r.name, (unknown.get(r.name) || 0) + 1);
  }

  const compuMethods = compuMethodNodes.map(parseCompuMethod);

  // /include 是字段级关键字（见 collectIncludes），合并去重
  for (const p of tokenIncludes || []) {
    if (p && !includes.includes(p)) includes.push(p);
  }

  const project = {};
  parseXcpIfData(roots, project);

  return {
    measurements,
    characteristics,
    compuMethods,
    includes,
    unknownBlocks: [...unknown.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    xcpDaqCanIds: project.xcpDaqCanIds || [],
    xcpFirstPids: project.xcpFirstPids || [],
    stats: {
      measurements: measurements.length,
      characteristics: characteristics.length,
      compuMethods: compuMethods.length,
      includes: includes.length,
      unknownBlockTypes: unknown.size,
      unknownBlockCount: [...unknown.values()].reduce((a, b) => a + b, 0)
    },
    errors
  };
}

module.exports = { parseA2LDocument, tokenize, parseA2L, EXT_FLAG };
