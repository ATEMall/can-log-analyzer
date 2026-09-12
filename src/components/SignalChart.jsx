import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Empty, Typography, Tag, Button, Divider, Dropdown } from 'antd';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';
import { SIGNAL_PALETTE, SIGNAL_PALETTE_LENGTH } from '../palette';
import { minMaxDownsampleIndices, MAX_RENDER_POINTS } from '../chartDownsample.mjs';
import { useThemeTokens } from '../theme';

const { Text } = Typography;

// Chart-neutral SVG colours recharts needs as concrete values (CSS var()
// is not accepted by SVG attributes). Light values below mirror index.css;
// dark mode resolves through the stylesheet — see theme.js CHART_TOKEN_DEFAULTS.
const CHART_DEFAULTS = {
  '--chart-grid': '#f0f0f0',
  '--text-quiet': '#8c8c8c',
  '--text-base': '#333333',
  '--bg-panel': '#ffffff',
  '--border-subtle': '#f0f0f0'
};

// Padding-aware Y domain for ONE axis, computed from that axis' visible curves
// only. Padding keeps constant-value curves (e.g. all zeros) visible instead of
// collapsing the axis to zero height.
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

function SignalChart({ signalData, selectedSignals, dbcMessages, maxRenderPoints = MAX_RENDER_POINTS }) {
  const hasData = Array.isArray(signalData) && signalData.length > 0;

  // ---- All hooks first (keeps hook order stable across data states) ----

  // Which curves are currently visible (filter bar)
  const [visibleKeys, setVisibleKeys] = useState(() => new Set(selectedSignals.map(s => s.key)));

  // Fixed, deterministic ordering for legend / filter bar / curve colors.
  // Signals are sorted by message ID first, then by signal name using a
  // numeric-aware comparison so e.g. B0, B1, ..., B7 always stay in order
  // regardless of selection order or window width.
  const sortedSignals = useMemo(() => {
    const naturalCompare = (a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...selectedSignals].sort((x, y) => {
      if (x.msgId !== y.msgId) return x.msgId - y.msgId;
      return naturalCompare(x.signalName, y.signalName);
    });
  }, [selectedSignals]);

  // Keep visibility in sync when the selected signal set changes:
  // newly added signals show by default, removed signals are cleaned up.
  useEffect(() => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      for (const sig of selectedSignals) {
        if (!next.has(sig.key)) next.add(sig.key);
      }
      for (const k of next) {
        if (!selectedSignals.some(s => s.key === k)) next.delete(k);
      }
      return next;
    });
  }, [selectedSignals]);

  const toggleSignal = useCallback((key) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(
    () => setVisibleKeys(new Set(selectedSignals.map(s => s.key))),
    [selectedSignals]
  );
  const showNone = useCallback(() => setVisibleKeys(new Set()), []);

  // Build chart data. Large logs are decimated with per-signal min/max bucket
  // downsampling so transient spikes (worst-case values) are never dropped,
  // unlike the previous equal-step sampler. Only numeric finite values survive.
  const chartData = useMemo(() => {
    if (!hasData) return [];
    const keys = selectedSignals.map(s => s.key);
    const indices = minMaxDownsampleIndices(signalData, keys, maxRenderPoints);
    const data = [];
    for (const i of indices) {
      const row = signalData[i];
      const t = Number(row.t);
      const point = { t: Number.isFinite(t) ? Number(t.toFixed(4)) : i };
      for (const sig of selectedSignals) {
        const val = row.signals && row.signals[sig.key];
        if (typeof val === 'number' && Number.isFinite(val)) {
          point[sig.key] = val;
        }
      }
      data.push(point);
    }
    return data;
  }, [signalData, selectedSignals, hasData, maxRenderPoints]);

  const isDownsampled = hasData && signalData.length > maxRenderPoints;

  // Unit per signal (from DBC metadata) — drives the multi-axis auto grouping
  // and the legend label suffix.
  const signalUnits = useMemo(() => {
    const units = {};
    for (const sig of selectedSignals) {
      let unit = '';
      for (const msg of dbcMessages) {
        if (msg.id === sig.msgId) {
          const dbcSig = msg.signals.find(s => s.name === sig.signalName);
          if (dbcSig && dbcSig.unit) unit = dbcSig.unit;
          break;
        }
      }
      units[sig.key] = unit;
    }
    return units;
  }, [selectedSignals, dbcMessages]);

  // Build legend labels with units
  const signalLabels = useMemo(() => {
    const labels = {};
    for (const sig of selectedSignals) {
      const unit = signalUnits[sig.key];
      labels[sig.key] = unit ? `${sig.signalName} (${unit})` : sig.signalName;
    }
    return labels;
  }, [selectedSignals, signalUnits]);

  // ---- R13 multi Y-axis ----
  // Per-signal manual axis override ('left' | 'right'); absent = auto grouping.
  const [axisOverrides, setAxisOverrides] = useState({});

  // Drop overrides for signals that are no longer selected.
  useEffect(() => {
    setAxisOverrides(prev => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const next = {};
      let changed = false;
      for (const k of keys) {
        if (selectedSignals.some(s => s.key === k)) next[k] = prev[k];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedSignals]);

  // Auto grouping: same unit (量纲) shares one axis. The largest unit group
  // takes the left axis (ties resolved by the deterministic sorted order);
  // every other unit group goes to the right axis. Single-unit selections stay
  // on a single axis.
  const autoAxis = useMemo(() => {
    const groups = new Map(); // unit -> [signalKey]
    for (const sig of sortedSignals) {
      const unit = signalUnits[sig.key] || '';
      if (!groups.has(unit)) groups.set(unit, []);
      groups.get(unit).push(sig.key);
    }
    const map = {};
    if (groups.size <= 1) {
      for (const sig of sortedSignals) map[sig.key] = 'left';
      return map;
    }
    let bestUnit = null;
    let bestSize = -1;
    for (const [unit, keys] of groups) {
      if (keys.length > bestSize) { bestSize = keys.length; bestUnit = unit; }
    }
    for (const [unit, keys] of groups) {
      for (const k of keys) map[k] = unit === bestUnit ? 'left' : 'right';
    }
    return map;
  }, [sortedSignals, signalUnits]);

  // Effective axis for a signal = manual override, else auto grouping.
  const axisOf = useCallback(
    (key) => axisOverrides[key] || autoAxis[key] || 'left',
    [axisOverrides, autoAxis]
  );

  const setSignalAxis = useCallback((key, axis) => {
    setAxisOverrides(prev => (prev[key] === axis ? prev : { ...prev, [key]: axis }));
  }, []);

  // Visible signals on each axis.
  const leftVisibleKeys = useMemo(
    () => sortedSignals.filter(s => visibleKeys.has(s.key) && axisOf(s.key) === 'left').map(s => s.key),
    [sortedSignals, visibleKeys, axisOf]
  );
  const rightVisibleKeys = useMemo(
    () => sortedSignals.filter(s => visibleKeys.has(s.key) && axisOf(s.key) === 'right').map(s => s.key),
    [sortedSignals, visibleKeys, axisOf]
  );
  const hasRightAxis = rightVisibleKeys.length > 0;

  // One independently scaled Y domain per axis.
  const leftDomain = useMemo(() => computeDomain(chartData, leftVisibleKeys), [chartData, leftVisibleKeys]);
  const rightDomain = useMemo(() => computeDomain(chartData, rightVisibleKeys), [chartData, rightVisibleKeys]);

  // Axis tint = colour of that axis' first signal (in deterministic order), so
  // the axis colour always matches a real curve drawn against it.
  const axisColorFor = useCallback((axis) => {
    const idx = sortedSignals.findIndex(s => axisOf(s.key) === axis);
    if (idx < 0) return null;
    return SIGNAL_PALETTE[idx % SIGNAL_PALETTE_LENGTH];
  }, [sortedSignals, axisOf]);

  const leftAxisColor = axisColorFor('left');
  const rightAxisColor = axisColorFor('right');

  // ---- Measure the chart container ----
  // ResponsiveContainer with height="100%" renders nothing when its parent has
  // 0 height (broken flex height chain). We measure the wrapper ourselves and
  // fall back to a fixed pixel height until a real size is available, so the
  // chart always has a non-zero rendering height.
  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    let rafId = 0;
    let timer = null;
    const update = () => {
      rafId = 0;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setChartSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    rafId = requestAnimationFrame(update);
    // Re-check shortly after mount in case flex layout settles late.
    timer = setTimeout(update, 250);
    return () => {
      if (ro) ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Theme-aware SVG colours (grid stroke, axis text, tooltip shell). The hook
  // re-resolves on <html data-theme> flips so a live theme switch re-paints
  // the chart without a reload.
  const tokens = useThemeTokens(
    ['--chart-grid', '--text-quiet', '--text-base', '--bg-panel', '--border-subtle'],
    CHART_DEFAULTS
  );

  // ---- Conditional renders (after all hooks) ----

  if (!hasData) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="解码后可查看曲线"
        style={{ padding: 40 }}
      />
    );
  }

  if (chartData.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="无有效数据点用于绘图"
        style={{ padding: 40 }}
      />
    );
  }

  // Render each visible signal as a separate Line (colors are assigned from
  // the fixed sorted order so they stay stable across filtering/width changes)
  const lines = sortedSignals
    .filter(sig => visibleKeys.has(sig.key))
    .map((sig, idx) => {
      const originalIdx = sortedSignals.indexOf(sig);
      return (
        <Line
          key={sig.key}
          yAxisId={axisOf(sig.key)}
          type="monotone"
          dataKey={sig.key}
          name={signalLabels[sig.key]}
          stroke={SIGNAL_PALETTE[originalIdx % SIGNAL_PALETTE_LENGTH]}
          strokeWidth={1.5}
          dot={false}
          // Each frame row only carries the signals of that frame's message,
          // so other signals are null between frames. Connect those null gaps
          // to draw a continuous curve; otherwise the chart shows isolated dots.
          connectNulls
          isAnimationActive={false}
        />
      );
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {/* Curve filter bar: explicit flex-wrap so buttons/tags never collide
          with the search box above when the window is narrow */}
      <div
        data-testid="chart-filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px 6px',
          marginBottom: 8,
          paddingBottom: 4
        }}
      >
        <Button size="small" type="link" style={{ padding: '0 4px' }} onClick={showAll}>全部</Button>
        <Button size="small" type="link" style={{ padding: '0 4px' }} onClick={showNone}>清空</Button>
        <Divider type="vertical" style={{ margin: '0 2px' }} />
        {sortedSignals.map((sig, idx) => {
          const visible = visibleKeys.has(sig.key);
          return (
            <Tag
              key={sig.key}
              color={visible ? SIGNAL_PALETTE[idx % SIGNAL_PALETTE_LENGTH] : undefined}
              style={{
                cursor: 'pointer',
                opacity: visible ? 1 : 0.5,
                fontSize: 11
              }}
              onClick={() => toggleSignal(sig.key)}
              title={visible ? '点击隐藏曲线' : '点击显示曲线'}
            >
              {sig.signalName}
            </Tag>
          );
        })}
      </div>
      {/* R13: per-signal Y-axis assignment (auto-grouped by unit, manually
          overridable). Axis tint matches the signal's curve colour. */}
      <div
        data-testid="chart-axis-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px 6px',
          marginBottom: 8
        }}
      >
        <Text type="secondary" style={{ fontSize: 11 }}>Y 轴：</Text>
        {sortedSignals.map((sig, idx) => {
          const axis = axisOf(sig.key);
          const color = SIGNAL_PALETTE[idx % SIGNAL_PALETTE_LENGTH];
          return (
            <Dropdown
              key={sig.key}
              trigger={['click']}
              menu={{
                items: [
                  { key: 'left', label: '左轴' },
                  { key: 'right', label: '右轴' }
                ],
                selectable: true,
                selectedKeys: [axis],
                onClick: ({ key }) => setSignalAxis(sig.key, key)
              }}
            >
              <Button
                size="small"
                data-testid={`axis-btn-${sig.key}`}
                style={{ fontSize: 11, borderColor: color, color }}
              >
                {sig.signalName} · {axis === 'left' ? '左' : '右'}
              </Button>
            </Dropdown>
          );
        })}
      </div>
      {isDownsampled && (
        <Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>
          数据量较大（{signalData.length} 点），已按 min/max 分桶保真降采样至 {chartData.length} 点（保留峰值）
        </Text>
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 350, minWidth: 0, position: 'relative' }}>
        <ResponsiveContainer
          width="100%"
          height={chartSize.h > 0 ? '100%' : 350}
          minHeight={350}
          minWidth={0}
        >
          <LineChart data={chartData} margin={{ top: 8, right: hasRightAxis ? 28 : 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens['--chart-grid']} />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: tokens['--text-quiet'] }}
              axisLine={{ stroke: tokens['--border-subtle'] }}
              tickLine={{ stroke: tokens['--border-subtle'] }}
              label={{
                value: '时间 (s)', position: 'insideBottomRight', offset: -5,
                style: { fontSize: 11, fill: tokens['--text-quiet'] }
              }}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: hasRightAxis && leftAxisColor ? leftAxisColor : tokens['--text-quiet'] }}
              axisLine={{ stroke: hasRightAxis && leftAxisColor ? leftAxisColor : tokens['--border-subtle'] }}
              tickLine={{ stroke: hasRightAxis && leftAxisColor ? leftAxisColor : tokens['--border-subtle'] }}
              domain={leftDomain}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: rightAxisColor || tokens['--text-quiet'] }}
                axisLine={{ stroke: rightAxisColor || tokens['--border-subtle'] }}
                tickLine={{ stroke: rightAxisColor || tokens['--border-subtle'] }}
                domain={rightDomain}
              />
            )}
            <Tooltip
              contentStyle={{
                fontSize: 11,
                background: tokens['--bg-panel'],
                border: `1px solid ${tokens['--border-subtle']}`,
                color: tokens['--text-base']
              }}
              itemStyle={{ color: tokens['--text-base'] }}
              labelStyle={{ color: tokens['--text-base'] }}
              cursor={{ stroke: tokens['--border-subtle'] }}
              formatter={(value, name) => [typeof value === 'number' ? value.toFixed(4) : value, name]}
              labelFormatter={(label) => `时间: ${label}s`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {lines}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default SignalChart;
