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

// 内联式地址与地址扩展：`ECU_ADDRESS 0x10090` / `ECU_ADDRESS_EXTENSION 2`
function inlineField(vals, key) {
  const idx = vals.findIndex((x) => String(x).toUpperCase() === key);
  if (idx >= 0 && idx + 1 < vals.length) return num(vals[idx + 1]);
  return null;
}

// IF_DATA 形式的地址（CANAPE_EXT 100 <addr> / ETK_XETK 100 <addr> 等）：
// IF_DATA 内容是平铺参数而非 /begin 子块，统一取「100 之后的数值」。
function addressFromIfData(node) {
  const ifd = findChild(node, 'IF_DATA');
  if (!ifd) return null;
  const av = (ifd.value || []).map(tokVal);
  const idx = av.indexOf('100');
  if (idx >= 0 && idx + 1 < av.length) return num(av[idx + 1]);
  for (const c of ifd.children || []) {
    const cv = (c.value || []).map(tokVal);
    const k = cv.indexOf('100');
    if (k >= 0 && k + 1 < cv.length) return num(cv[k + 1]);
  }
  return null;
}

function parseMeasurement(m) {
  const v = m.value || [];
  const vals = v.map(tokVal);
  // 地址优先取内联 ECU_ADDRESS（XCPlite 等），否则回落到 IF_DATA。
  const inlineAddr = inlineField(vals, 'ECU_ADDRESS');
  return {
    name: tokVal(v[0]),
    longIdentifier: tokVal(v[1]),
    datatype: tokVal(v[2]),
    compuMethod: tokVal(v[3]),
    resolution: num(tokVal(v[4])),
    accuracy: num(tokVal(v[5])),
    lowerLimit: num(tokVal(v[6])),
    upperLimit: num(tokVal(v[7])),
    address: inlineAddr != null ? inlineAddr : addressFromIfData(m),
    addressExtension: inlineField(vals, 'ECU_ADDRESS_EXTENSION'),
    arraySize: inlineField(vals, 'ARRAY_SIZE'),
    readWrite: vals.findIndex((x) => String(x).toUpperCase() === 'READ_WRITE') >= 0,
    hasXcpIfData: findChild(m, 'IF_DATA') != null
  };
}

function parseCharacteristic(c) {
  const v = c.value || [];
  const vals = v.map(tokVal);
  return {
    name: tokVal(v[0]),
    longIdentifier: tokVal(v[1]),
    type: tokVal(v[2]),
    address: num(tokVal(v[3])),
    recordLayout: tokVal(v[4]),
    maxDiff: num(tokVal(v[5])),
    compuMethod: tokVal(v[6]),
    addressExtension: inlineField(vals, 'ECU_ADDRESS_EXTENSION'),
    // PHYS_UNIT 的值是字符串（如 "ms"），不能用 num() 解析，直接取后续 token
    physUnit: (() => {
      const i = vals.findIndex((x) => String(x).toUpperCase() === 'PHYS_UNIT');
      return i >= 0 && i + 1 < vals.length ? String(vals[i + 1]) : null;
    })()
  };
}

// 取某关键字之后的数值，遇非数值（关键字/字符串）即停，避免越界吃到别的字段。
function numbersAfter(vals, keywordRe, max) {
  const i = vals.findIndex((x) => keywordRe.test(String(x)));
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < vals.length && out.length < max; k++) {
    const n = num(vals[k]);
    if (n === null) break;
    out.push(n);
  }
  return out;
}

function parseCompuMethod(c) {
  const v = (c.value || []).map(tokVal);
  const name = v[0];
  const type = v[2];
  const out = { name, longIdentifier: v[1], type, coeffs: [], pairs: [], compuTabRef: null };
  // COEFFS / COEFFS_LINEAR 之后：LINEAR 取 2 个（a,b），RAT_FUNC 取 6 个（a..f）
  const isLinear = String(type).toUpperCase() === 'LINEAR';
  if (/^(LINEAR|RAT_FUNC|RAT|FUNC)$/i.test(String(type || ''))) {
    out.coeffs = numbersAfter(v, /^COEFFS(_LINEAR)?$/i, isLinear ? 2 : 6);
  }
  // TAB_* 的数值对不在本块内，而在独立的 COMPU_TAB 块（见 parseCompuTab），此处只记引用名
  const ri = v.findIndex((x) => /^COMPU_TAB_REF$/i.test(String(x)));
  if (ri >= 0 && ri + 1 < v.length) out.compuTabRef = String(v[ri + 1]);
  return out;
}

// /begin COMPU_TAB <name> <longId> <conversionType> <numberValuePairs> <in out> × N
function parseCompuTab(c) {
  const v = (c.value || []).map(tokVal);
  const nums = [];
  // 前 3 项是 name / longIdentifier / conversionType，第 4 项是数值对个数，其后才是成对 in/out
  for (let k = 3; k < v.length; k++) {
    const n = num(v[k]);
    if (n !== null) nums.push(n);
  }
  const declared = nums.length > 0 ? nums[0] : null;
  const pairs = [];
  for (let k = 1; k + 1 < nums.length; k += 2) pairs.push([nums[k], nums[k + 1]]);
  return {
    name: v[0],
    longIdentifier: v[1],
    type: v[2],
    numberValuePairs: declared,
    pairs,
    // 声明个数与实际解析到的对数不一致时显式暴露，便于定位截断/多余
    pairCountMismatch: declared != null && pairs.length !== declared
  };
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
  let compuTabNodes = [];
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
    if (r.name === 'COMPU_TAB') { compuTabNodes.push(r); continue; }
    if (r.name === 'PROJECT' || r.name === 'MODULE' || r.name === 'HEADER') {
      measurements.push(...findAll(r, 'MEASUREMENT').map(parseMeasurement));
      characteristics.push(...findAll(r, 'CHARACTERISTIC').map(parseCharacteristic));
      compuMethodNodes.push(...findAll(r, 'COMPU_METHOD'));
      compuTabNodes.push(...findAll(r, 'COMPU_TAB'));
      continue;
    }
    if (r.name === 'INCLUDE') { includes.push(String(tokVal((r.value || [])[0])).replace(/^"|"$/g, '')); continue; }
    if (!known.has(r.name)) unknown.set(r.name, (unknown.get(r.name) || 0) + 1);
  }

  const compuMethods = compuMethodNodes.map(parseCompuMethod);
  const compuTabs = compuTabNodes.map(parseCompuTab);

  // TAB_* 类型的 COMPU_METHOD 通过 COMPU_TAB_REF 指向独立的 COMPU_TAB 块，
  // 必须在此关联，否则插值表为空、物理值换算无解。
  const tabByName = new Map(compuTabs.map((t) => [t.name, t]));
  for (const cm of compuMethods) {
    if (!cm.compuTabRef) continue;
    const t = tabByName.get(cm.compuTabRef);
    if (t) {
      cm.pairs = t.pairs;
      cm.pairsFromTab = t.name;
    } else {
      cm.tabRefMissing = true; // 引用缺失显式标记，不静默当成空表
    }
  }

  // /include 是字段级关键字（见 collectIncludes），合并去重
  for (const p of tokenIncludes || []) {
    if (p && !includes.includes(p)) includes.push(p);
  }

  const project = {};
  parseXcpIfData(roots, project);

  return {
    // 暴露解析树供上层做深度查询（如 XCP 传输层扫描、自定义块检索）
    roots,
    measurements,
    characteristics,
    compuMethods,
    compuTabs,
    includes,
    unknownBlocks: [...unknown.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    xcpDaqCanIds: project.xcpDaqCanIds || [],
    xcpFirstPids: project.xcpFirstPids || [],
    stats: {
      measurements: measurements.length,
      characteristics: characteristics.length,
      compuMethods: compuMethods.length,
      compuTabs: compuTabs.length,
      includes: includes.length,
      unknownBlockTypes: unknown.size,
      unknownBlockCount: [...unknown.values()].reduce((a, b) => a + b, 0)
    },
    errors
  };
}

// ---------- COMPU_METHOD 换算（raw ↔ physical） ----------
const NO_COMPU = /^NO_COMPU_METHOD$/i;

/**
 * 用 COMPU_METHOD 把原始值换算成物理量。
 * 支持 LINEAR（a*x+b）、RAT_FUNC（有理函数）、TAB_INTP（线性插值）、
 * TAB_NOINTP（取最接近）、NO_COMPU_METHOD（恒等）。
 * TAB_VERB / VERB_TAB 的文本表暂返回原名\otimes（需 COMPU_VTAB 配合，见 README 边界）。
 */
function convertToPhysical(cm, raw) {
  if (!cm || NO_COMPU.test(String(cm.name)) || NO_COMPU.test(String(cm.type))) return raw;
  const type = String(cm.type).toUpperCase();
  if (type === 'LINEAR' || type === 'RAT_FUNC' || type === 'RAT' || type === 'FUNC') {
    const c = cm.coeffs || [];
    if (type === 'LINEAR') {
      // ASAP2 COEFFS_LINEAR: f(raw) = a*raw + b（依次为斜率 a、偏移量 b）
      const a = c.length > 0 ? c[0] : 1;
      const b = c.length > 1 ? c[1] : 0;
      return a * raw + b;
    }
    // RAT_FUNC: f(x) = (a*x^2 + b*x + c) / (d*x^2 + e*x + f)
    const [a = 0, b = 0, cc = 0, d = 0, e = 0, f = 1] = c;
    const num_ = a * raw * raw + b * raw + cc;
    const den = d * raw * raw + e * raw + f;
    return den === 0 ? null : num_ / den;
  }
  if (type === 'TAB_INTP') {
    const p = cm.pairs || [];
    if (!p.length) return null;
    if (raw <= p[0][0]) return p[0][1];
    if (raw >= p[p.length - 1][0]) return p[p.length - 1][1];
    for (let i = 0; i + 1 < p.length; i++) {
      if (raw >= p[i][0] && raw <= p[i + 1][0]) {
        const t = (raw - p[i][0]) / (p[i + 1][0] - p[i][0]);
        return p[i][1] + t * (p[i + 1][1] - p[i][1]);
      }
    }
    return null;
  }
  if (type === 'TAB_NOINTP') {
    const p = cm.pairs || [];
    if (!p.length) return null;
    let best = p[0];
    for (const q of p) if (Math.abs(q[0] - raw) < Math.abs(best[0] - raw)) best = q;
    return best[1];
  }
  return null; // 文本表等未支持类型显式返回 null，不伪造数值
}

// ---------- XCP 传输层识别 ----------
const XCP_TRANSPORTS = ['XCP_ON_CAN', 'XCP_ON_TCP_IP', 'XCP_ON_USB', 'XCP_ON_SXI', 'XCP_ON_FLX'];

// 递归收集节点树里出现的所有原始 token（块名 + 字段值）。
// 传输层关键字（XCP_ON_CAN 等）在 IF_DATA 里是平铺参数而非 /begin 子块，
// 只按块名查找会漏掉，故需一并扫描字段值。
function collectTokens(node, out) {
  if (!node) return out;
  const name = String(node.name || '');
  // A2ML 段是**类型声明**（taggedstruct 里会同时列出 CAN/TCP/USB/SXI/FLX 五种
  // 传输层备选），不是实际实例——必须整段跳过，否则会把声明误判成真实配置。
  if (name.toUpperCase() === 'A2ML') return out;
  out.push(name);
  for (const v of node.value || []) out.push(String(tokVal(v)));
  for (const c of node.children || []) collectTokens(c, out);
  return out;
}

function detectXcpTransport(doc) {
  const found = {};
  const tokens = [];
  for (const r of doc.roots || []) collectTokens(r, tokens);
  for (const t of XCP_TRANSPORTS) {
    const n = tokens.filter((x) => x.toUpperCase() === t).length;
    if (n) found[t] = n;
  }
  const types = Object.keys(found);
  return {
    types,
    counts: found,
    isCan: types.length > 0 && types.every((t) => t === 'XCP_ON_CAN'),
    // 无任何传输层块（如 XCPlite 的 autodetect）显式标为 unknown，不得默认成 CAN
    explicit: types.length > 0
  };
}

// ---------- /include 递归展开 ----------
/**
 * 解析 A2L 文件（含 /include 递归展开）。
 * @param {string} filePath 入口文件
 * @param {{resources?:object}} [opts] resources 可覆盖文件读取（测试用）
 * @returns {{document:object,expandedFiles:string[],missingIncludes:string[],maxDepth:number}}
 */
/**
 * 剥离 A2L 注释（`/* ... *\/` 与 `//`），保留字符串字面量内容。
 * 注释里出现的 `/INCLUDE "..."`（如版权说明、示例注释）不是真指令，
 * 必须在匹配 include 前剥离，否则会被误判为缺失文件。
 */
function stripComments(text) {
  const s = String(text);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { // 字符串原样保留（其中的 /* 或 // 不作为注释）
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      out += s.slice(i, Math.min(j + 1, s.length));
      i = j + 1;
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (ch === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i);
      i = end < 0 ? s.length : end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function parseA2LFile(filePath, opts) {
  opts = opts || {};
  const fs = require('fs');
  const pathLib = require('path');
  const readFn = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const existsFn = opts.exists || ((p) => fs.existsSync(p));

  const expandedFiles = [];
  const missingIncludes = [];
  const visited = new Set();
  let maxDepth = 0;

  function walk(absPath, rel, depth) {
    const key = require('path').resolve(absPath);
    if (visited.has(key)) return ''; // 防循环 include
    visited.add(key);
    maxDepth = Math.max(maxDepth, depth);
    if (!existsFn(absPath)) { missingIncludes.push(rel || absPath); return ''; }
    const text = stripComments(readFn(absPath));
    expandedFiles.push(rel || require('path').basename(absPath));
    // include 路径相对当前文件所在目录；此处做一次性文本内联拼接，让上层按单一文档解析
    const dir = pathLib.dirname(absPath);
    return String(text).replace(/(\/INCLUDE|\bINCLUDE)\s+"([^"]+)"/gi, (whole, _kw, inc) => {
      const childAbs = pathLib.resolve(dir, String(inc).replace(/\\/g, '/'));
      return walk(childAbs, inc, depth + 1);
    });
  }

  const merged = walk(require('path').resolve(filePath), require('path').basename(filePath), 0);
  const document = parseA2LDocument(merged);
  document.xcpTransport = detectXcpTransport(document);
  return { document, expandedFiles, missingIncludes, maxDepth };
}

module.exports = {
  parseA2LDocument, tokenize, parseA2L, parseA2LFile, convertToPhysical,
  detectXcpTransport, stripComments, EXT_FLAG, XCP_TRANSPORTS
};
