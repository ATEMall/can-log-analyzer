import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Empty, Typography, Tag, Button, Divider } from 'antd';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';

const { Text } = Typography;

// Colors for multiple signal lines
const LINE_COLORS = [
  '#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1',
  '#13c2c2', '#f5222d', '#2f54eb', '#faad14', '#a0d911'
];

function SignalChart({ signalData, selectedSignals, dbcMessages }) {
  const hasData = Array.isArray(signalData) && signalData.length > 0;

  // ---- All hooks first (keeps hook order stable across data states) ----

  // Downsample if > 5000 points
  const MAX_POINTS = 5000;
  const step = hasData && signalData.length > MAX_POINTS
    ? Math.ceil(signalData.length / MAX_POINTS)
    : 1;

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

  // Build chart data: one point per sampled row, only numeric finite values
  const chartData = useMemo(() => {
    if (!hasData) return [];
    const data = [];
    for (let i = 0; i < signalData.length; i += step) {
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
  }, [signalData, selectedSignals, step, hasData]);

  // Build legend labels with units
  const signalLabels = useMemo(() => {
    const labels = {};
    for (const sig of selectedSignals) {
      let unit = '';
      for (const msg of dbcMessages) {
        if (msg.id === sig.msgId) {
          const dbcSig = msg.signals.find(s => s.name === sig.signalName);
          if (dbcSig && dbcSig.unit) unit = dbcSig.unit;
          break;
        }
      }
      labels[sig.key] = unit ? `${sig.signalName} (${unit})` : sig.signalName;
    }
    return labels;
  }, [selectedSignals, dbcMessages]);

  // Y-axis domain computed from visible curves only.
  // Adds padding so constant-value curves (e.g. all zeros) stay visible
  // instead of collapsing the axis to zero height.
  const yDomain = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of chartData) {
      for (const key of visibleKeys) {
        const v = p[key];
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
  }, [chartData, visibleKeys]);

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
          type="monotone"
          dataKey={sig.key}
          name={signalLabels[sig.key]}
          stroke={LINE_COLORS[originalIdx % LINE_COLORS.length]}
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
              color={visible ? LINE_COLORS[idx % LINE_COLORS.length] : undefined}
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
      {step > 1 && (
        <Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>
          数据量较大（{signalData.length} 点），已降采样至 {chartData.length} 点用于绘图
        </Text>
      )}
      <div ref={chartRef} style={{ flex: 1, minHeight: 350, minWidth: 0, position: 'relative' }}>
        <ResponsiveContainer
          width="100%"
          height={chartSize.h > 0 ? '100%' : 350}
          minHeight={350}
          minWidth={0}
        >
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10 }}
              label={{ value: '时间 (s)', position: 'insideBottomRight', offset: -5, style: { fontSize: 11 } }}
            />
            <YAxis tick={{ fontSize: 10 }} domain={yDomain} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
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
