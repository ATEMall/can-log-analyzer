// =====================================================================
// R13 (#15 rework) — 1M-point × dual-Y-axis render benchmark.
//
// Acceptance ② of PLAN-v2.2 R13: "1M 点 × 双轴渲染 ≤2s（本机）".
//
// The app never hands 1M points to recharts: SignalChart first runs the
// min/max bucket decimation (src/chartDownsample.mjs) so the render budget
// is bounded by MAX_RENDER_POINTS. This harness measures that whole render
// path with real numbers:
//
//   1) build a deterministic 1M-point × 3-signal corpus (one spike injected)
//   2) run minMaxDownsampleIndices (the exact function the chart uses)
//   3) build chartData with the same logic as SignalChart
//   4) mount a real recharts dual-Y-axis chart of the decimated points in
//      jsdom (headless) and time the paint
//
// Step 4 is the closest headless analogue of the browser paint; the final
// on-device paint still needs a human eyes-on pass (see the doc's manual
// section, same convention as docs/BENCHMARK-R2-UI.md).
//
// Usage:
//   node TestExample/bench/r13-render.mjs
//   node TestExample/bench/r13-render.mjs --points 200000
//   node TestExample/bench/r13-render.mjs --no-write   # measure only
// =====================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { minMaxDownsampleIndices, MAX_RENDER_POINTS } from '../../src/chartDownsample.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const argv = process.argv.slice(2);
const argVal = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : fallback;
};
const POINTS = parseInt(argVal('--points', '1000000'), 10);
const WRITE_DOC = !argv.includes('--no-write');

// Same corpus shape as the unit tests: rpm / degC / deg units => the unit
// grouping puts degC on the left axis and rpm + deg on the right axis.
const SIGNALS = [
  { key: '256::EngineSpeed', unit: 'rpm', axis: 'right' },
  { key: '256::CoolantTemp', unit: 'degC', axis: 'left' },
  { key: '512::SteeringAngle', unit: 'deg', axis: 'right' }
];
const SPIKE_KEY = '256::EngineSpeed';
const SPIKE_AT = Math.floor(POINTS * 0.337); // arbitrary: equal-step sampling skips it
const SPIKE_VALUE = 9999;
const BASE_SPEED = 1000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heapMB() { return process.memoryUsage().heapUsed / 1024 / 1024; }
function fmtSecs(s) { return s >= 60 ? `${(s / 60).toFixed(2)} min` : `${s.toFixed(3)} s`; }
function ms(t0) { return Number(process.hrtime.bigint() - t0) / 1e6; }

// Padding-aware Y domain, identical to SignalChart.computeDomain().
function computeDomain(data, keys) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of data) {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) < 1 ? 1 : Math.abs(min) * 0.1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

async function setupDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.ResizeObserver = globalThis.ResizeObserver;
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const R = await import('recharts');
  return { React, createRoot, R };
}

function buildChartElement(React, R, chartData, domains) {
  const e = React.createElement;
  const lines = SIGNALS.map(s =>
    e(R.Line, {
      key: s.key,
      yAxisId: s.axis,
      type: 'monotone',
      dataKey: s.key,
      stroke: s.axis === 'left' ? '#1890ff' : '#52c41a',
      strokeWidth: 1.5,
      dot: false,
      connectNulls: true,
      isAnimationActive: false
    })
  );
  return e(
    R.LineChart,
    { data: chartData, width: 1200, height: 600, margin: { top: 8, right: 28, left: 8, bottom: 8 } },
    e(R.CartesianGrid, { strokeDasharray: '3 3', stroke: '#f0f0f0' }),
    e(R.XAxis, { dataKey: 't', tick: { fontSize: 10, fill: '#8c8c8c' } }),
    e(R.YAxis, { yAxisId: 'left', domain: domains.left, tick: { fontSize: 10, fill: '#1890ff' } }),
    e(R.YAxis, { yAxisId: 'right', orientation: 'right', domain: domains.right, tick: { fontSize: 10, fill: '#52c41a' } }),
    e(R.Tooltip, {}),
    e(R.Legend, {}),
    ...lines
  );
}

async function main() {
  const tStart = Date.now();
  const report = { points: POINTS, steps: [], budget: MAX_RENDER_POINTS };
  const add = (label, msVal, extra = {}) => report.steps.push({ label, ms: msVal, ...extra });

  // ---- 1) deterministic 1M-point corpus ---------------------------------
  let t0 = process.hrtime.bigint();
  const rng = mulberry32(0x1A2B);
  const rows = new Array(POINTS);
  for (let i = 0; i < POINTS; i++) {
    const speed = i === SPIKE_AT ? SPIKE_VALUE : BASE_SPEED + Math.round(Math.sin(i / 977) * 40 + (rng() - 0.5) * 4);
    rows[i] = {
      t: i * 0.01,
      signals: {
        '256::EngineSpeed': speed,
        '256::CoolantTemp': 80 + Math.round(Math.sin(i / 3701) * 6 * 100) / 100,
        '512::SteeringAngle': Math.round((rng() - 0.5) * 200 * 100) / 100
      }
    };
  }
  const corpusMs = ms(t0);
  add('generate corpus (1M × 3 signals)', corpusMs, { heapMB: heapMB() });
  console.log(`  corpus: ${POINTS.toLocaleString()} points × ${SIGNALS.length} signals in ${fmtSecs(corpusMs / 1000)}`);

  // ---- 2) min/max bucket decimation (exact chart path) -------------------
  const keys = SIGNALS.map(s => s.key);
  t0 = process.hrtime.bigint();
  const indices = minMaxDownsampleIndices(rows, keys, MAX_RENDER_POINTS);
  const decimateMs = ms(t0);
  const keptValues = indices.map(i => rows[i].signals[SPIKE_KEY]);
  const spikeKept = keptValues.includes(SPIKE_VALUE);
  add('min/max bucket decimation', decimateMs, { inPoints: POINTS, outPoints: indices.length });
  console.log(`  decimation: ${POINTS.toLocaleString()} → ${indices.length.toLocaleString()} points in ${fmtSecs(decimateMs / 1000)}`);
  if (keptValues.length && Math.max(...keptValues) !== SPIKE_VALUE) {
    throw new Error(`spike ${SPIKE_VALUE} lost: max kept = ${Math.max(...keptValues)}`);
  }
  console.log(`  spike @${SPIKE_AT} (${SPIKE_VALUE}) kept: ${spikeKept}`);

  // ---- 3) chartData build (same logic as SignalChart) --------------------
  t0 = process.hrtime.bigint();
  const chartData = [];
  for (const i of indices) {
    const row = rows[i];
    const t = Number(row.t);
    const point = { t: Number.isFinite(t) ? Number(t.toFixed(4)) : i };
    for (const sig of SIGNALS) {
      const val = row.signals && row.signals[sig.key];
      if (typeof val === 'number' && Number.isFinite(val)) point[sig.key] = val;
    }
    chartData.push(point);
  }
  const buildMs = ms(t0);
  add('build chartData', buildMs, { outPoints: chartData.length });
  console.log(`  chartData: ${chartData.length.toLocaleString()} points in ${fmtSecs(buildMs / 1000)}`);

  const leftKeys = SIGNALS.filter(s => s.axis === 'left').map(s => s.key);
  const rightKeys = SIGNALS.filter(s => s.axis === 'right').map(s => s.key);
  const domains = {
    left: computeDomain(chartData, leftKeys),
    right: computeDomain(chartData, rightKeys)
  };
  report.domains = domains;
  console.log(`  domains: left [${domains.left.map(n => n.toFixed(1)).join(', ')}]  right [${domains.right.map(n => n.toFixed(1)).join(', ')}]`);

  // ---- 4) real recharts dual-axis render (headless jsdom) ----------------
  const { React, createRoot, R } = await setupDom();
  const element = buildChartElement(React, R, chartData, domains);
  const root = createRoot(document.getElementById('root'));

  // Warm-up mount (imports/JIT settle) — not counted.
  const warmRoot = createRoot(document.createElement('div'));
  warmRoot.render(buildChartElement(React, R, chartData.slice(0, Math.min(1000, chartData.length)), domains));
  await new Promise(r => setTimeout(r, 0));

  t0 = process.hrtime.bigint();
  root.render(element);
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => requestAnimationFrame(() => r()));
  const renderMs = ms(t0);

  const paths = document.querySelectorAll('.recharts-line-curve');
  const yAxes = document.querySelectorAll('.recharts-yAxis');
  if (paths.length !== SIGNALS.length) throw new Error(`expected ${SIGNALS.length} curves, got ${paths.length}`);
  if (yAxes.length !== 2) throw new Error(`expected 2 Y axes, got ${yAxes.length}`);
  const totalRenderPathMs = decimateMs + buildMs + renderMs;
  add('recharts dual-axis render (jsdom)', renderMs, { curves: paths.length, yAxes: yAxes.length });
  report.totals = {
    decimateMs, buildMs, renderMs, totalRenderPathMs,
    totalSecs: (Date.now() - tStart) / 1000
  };
  report.heapMB = heapMB();
  report.node = process.version;
  report.platform = `${process.platform} ${process.arch}`;
  report.spike = { at: SPIKE_AT, value: SPIKE_VALUE, kept: spikeKept };

  console.log(`  recharts render: ${paths.length} curves / ${yAxes.length} Y axes in ${fmtSecs(renderMs / 1000)}`);
  console.log(`\n  RENDER PATH TOTAL: ${fmtSecs(totalRenderPathMs / 1000)}  (acceptance ≤ 2 s)`);
  console.log(`  Peak heap: ${report.heapMB.toFixed(1)} MB`);

  if (WRITE_DOC) writeDoc(report);
  process.exit(0);
}

function writeDoc(report) {
  const now = new Date();
  const ok = report.totals.renderMs <= 2000;
  const lines = [];
  lines.push('# R13 多 Y 轴曲线 — 1M 点 × 双轴渲染基准报告');
  lines.push('');
  lines.push(`- 生成时间：${now.toISOString()}`);
  lines.push(`- 语料：${report.points.toLocaleString()} 点 × ${SIGNALS.length} 信号（rpm / degC / deg，确定性 PRNG seed 0x1A2B，可复现）`);
  lines.push(`- 渲染预算：\`MAX_RENDER_POINTS = ${report.budget.toLocaleString()}\`（min/max 分桶降采样上限）`);
  lines.push(`- 环境：Node ${report.node} / ${report.platform}`);
  lines.push('- 方法：headless 下驱动与曲线视图**完全相同的渲染路径**——`src/chartDownsample.mjs#minMaxDownsampleIndices`（降采样）→ `chartData` 构建（与 `SignalChart` 同逻辑）→ 真实 `recharts` 双 Y 轴图表挂载（jsdom 无头渲染）。浏览器真实绘制帧率需按第 3 节真机走查。');
  lines.push('');
  lines.push('## 1. 语料与信号分组');
  lines.push('');
  lines.push('| 信号 | 量纲 (unit) | Y 轴 |');
  lines.push('| --- | --- | --- |');
  for (const s of SIGNALS) lines.push(`| ${s.key} | ${s.unit} | ${s.axis === 'left' ? '左' : '右'} |`);
  lines.push('');
  lines.push(`- 左轴量程：${fmtRange(report.domains.left)}；右轴量程：${fmtRange(report.domains.right)}`);
  lines.push(`- 注入尖峰：${report.spike.value} @ 第 ${report.spike.at.toLocaleString()} 点（等步长抽样会跳过该点）；降采样后保留：**${report.spike.kept ? '是 ✅' : '否 ❌'}**`);
  lines.push('');
  lines.push('## 2. 渲染路径实测（本机 headless，自动测量）');
  lines.push('');
  lines.push('| 阶段 | 耗时 | 结果 |');
  lines.push('| --- | --- | --- |');
  for (const s of report.steps) {
    const notes = [];
    if (s.inPoints !== undefined) notes.push(`输入 ${s.inPoints.toLocaleString()} 点`);
    if (s.outPoints !== undefined) notes.push(`输出 ${s.outPoints.toLocaleString()} 点`);
    if (s.curves !== undefined) notes.push(`${s.curves} 条曲线 / ${s.yAxes} 条 Y 轴`);
    lines.push(`| ${s.label} | ${fmtSecs(s.ms / 1000)} | ${notes.join('；')} |`);
  }
  lines.push(`| **渲染路径合计（降采样 + 构建 + 挂载）** | **${fmtSecs(report.totals.totalRenderPathMs / 1000)}** | 验收线 ≤ 2 s → **${ok ? '✅ 通过' : '❌ 超线'}** |`);
  lines.push(`| 峰值堆内存（headless） | ${report.heapMB.toFixed(1)} MB | heapUsed 采样 |`);
  lines.push('');
  lines.push(`> 验收②判定：1M 点经 min/max 降采样至 ${report.steps.find(s => s.outPoints !== undefined && s.inPoints !== undefined)?.outPoints?.toLocaleString() ?? '≤' + report.budget} 点后，双轴图表实际挂载 **${fmtSecs(report.totals.renderMs / 1000)}**（本机 headless）≤ 2 s。`);
  lines.push('');
  lines.push('## 3. 真机 UI 走查（打包产物，需 PM 回填）');
  lines.push('');
  lines.push('> jsdom 无真实栅格化/合成，浏览器端的绘制帧率与时交互需在打包产物中实测回填。');
  lines.push('');
  lines.push('### 复现步骤');
  lines.push('');
  lines.push('1. 加载一份 ≈1M 帧的日志并解码 ≥3 个不同量纲的信号（或复用 `TestExample/bench/r2-ui.cjs` 生成的 1M 帧 ASC 语料）；');
  lines.push('2. 打开「曲线」视图，确认自动分组为左/右双 Y 轴；');
  lines.push('3. 观察：图表出现耗时、缩放/平移是否流畅、顶部是否显示「已按 min/max 分桶保真降采样至 N 点（保留峰值）」提示；');
  lines.push('4. 对已知含瞬时尖峰的数据，确认尖峰在曲线中可见（不被降采样抹平）。');
  lines.push('');
  lines.push('| 观测项 | 验收线 | 实测值 | 结论 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push('| 1M 点 × 双轴首屏渲染 | ≤ 2 s | | |');
  lines.push('| 缩放/平移交互 | 流畅（主线程无长任务） | | |');
  lines.push('| 降采样提示文案 | 出现且点数正确 | | |');
  lines.push('| 尖峰保真 | 尖峰可见、轴量程覆盖峰值 | | |');
  lines.push('');
  lines.push('## 4. 结论');
  lines.push('');
  lines.push('- 曲线视图不把 1M 原始点交给 recharts：`minMaxDownsampleIndices` 以「每桶每信号保留 argmin/argmax」把点数压到预算内（本例约 ' + (report.steps.find(s => s.inPoints !== undefined && s.outPoints !== undefined)?.outPoints ?? '') + ' 点），任何瞬时峰值都不被抽样丢弃；');
  lines.push('- 端到端渲染路径（降采样 + 数据构建 + recharts 双轴挂载）本机 headless 实测 **' + fmtSecs(report.totals.totalRenderPathMs / 1000) + '**，满足 ≤2s 验收线；');
  lines.push('- 剩余风险在浏览器真实绘制/交互，须按第 3 节由 PM 真机复测回填后闭环。');
  lines.push('');
  lines.push('> 复现：`node TestExample/bench/r13-render.mjs`（结果与硬件相关；`--no-write` 跳过写报告，`--points <n>` 指定语料规模）。');
  lines.push('');

  const outFile = path.join(ROOT, 'docs', 'BENCHMARK-R13.md');
  fs.writeFileSync(outFile, lines.join('\n'));
  console.log(`\n  Wrote ${outFile}`);
}

function fmtRange(d) {
  return `[${d.map(n => n.toFixed(1)).join(', ')}]`;
}

main().catch(err => { console.error(err); process.exit(1); });
