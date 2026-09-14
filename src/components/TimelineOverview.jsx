import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip, Typography } from 'antd';
import { ExpandOutlined, ZoomInOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Canvas colours must be concrete (CSS var() is not accepted by the 2D
// context). Values mirror src/index.css design tokens; the live values are
// read back through getComputedStyle so theme switching keeps working.
const FALLBACK = {
  brand: '#c62828',
  faint: '#bfbfbf',
  panel: '#ffffff'
};

// Stacked heat-bar alpha ramp: the most frequent ID is the most saturated.
const ID_ALPHAS = [0.95, 0.78, 0.62, 0.48, 0.36, 0.26];

function readToken(name, fallback) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return fallback;
  try {
    const v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  } catch {
    return fallback;
  }
}

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  // eslint-disable-next-line no-bitwise
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function formatTime(t) {
  if (!Number.isFinite(t)) return '-';
  return `${t.toFixed(3)}s`;
}

/**
 * R11 (v2.2) — 时间轴总览（minimap）。
 *
 * 底部全局缩放条：显示全时间跨度 + 当前视窗；拖拽平移、滚轮/双击缩放；
 * 密度热条按 top-N ID 堆叠渲染。视窗变化通过 onWindowChange 冒泡到 App，
 * 由报文表与曲线视图共享（同一 timeWindow 状态）。
 */
function TimelineOverview({
  timeline,
  window: timeWindow,
  onWindowChange,
  height = 54,
  testId = 'timeline-overview',
  dbcMessages = []
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
  const dragRef = useRef(null);
  const changeRef = useRef(onWindowChange);
  changeRef.current = onWindowChange;

  const tStart = timeline?.tStart ?? 0;
  const tEnd = timeline?.tEnd ?? 0;
  const span = tEnd - tStart;

  const idNameMap = useMemo(() => {
    const m = {};
    for (const msg of dbcMessages) m[msg.id] = msg.name;
    return m;
  }, [dbcMessages]);

  // Measure the container so the canvas can be sized in CSS pixels.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Normalised current window (fractions of the full span).
  const view = useMemo(() => {
    if (!(span > 0)) return { a: 0, b: 1 };
    let a = timeWindow ? (timeWindow.start - tStart) / span : 0;
    let b = timeWindow ? (timeWindow.end - tStart) / span : 1;
    a = Math.min(1, Math.max(0, a));
    b = Math.min(1, Math.max(0, b));
    if (b - a < 0.0005) b = Math.min(1, a + 0.0005);
    return { a, b };
  }, [timeWindow, tStart, span]);

  // ---- Canvas: stacked density heat bars ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !timeline || !timeline.buckets?.length) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (!ctx) return; // jsdom / unsupported: nothing to paint

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const brand = readToken('--brand', FALLBACK.brand);
    const faint = readToken('--text-faint', FALLBACK.faint);
    const panel = readToken('--bg-panel', FALLBACK.panel);

    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, width, height);

    const n = timeline.buckets.length;
    const bucketW = Math.max(1, width / n);
    const max = timeline.maxCount || 1;
    const perId = timeline.perId || [];

    for (let i = 0; i < n; i++) {
      const x = (i / n) * width;
      let stack = 0;
      let topSum = 0;
      for (const entry of perId) topSum += entry.counts[i] || 0;
      const other = Math.max(0, timeline.buckets[i] - topSum);

      // Bottom: frames from IDs outside the top-N (faint).
      if (other > 0) {
        const h = (other / max) * height;
        ctx.fillStyle = hexToRgba(faint, 0.55);
        ctx.fillRect(x, height - stack - h, bucketW, h);
        stack += h;
      }
      // Above: one segment per top ID, most frequent first.
      for (let k = 0; k < perId.length; k++) {
        const v = perId[k].counts[i] || 0;
        if (v <= 0) continue;
        const h = (v / max) * height;
        ctx.fillStyle = hexToRgba(brand, ID_ALPHAS[k] ?? 0.24);
        ctx.fillRect(x, height - stack - h, bucketW, h);
        stack += h;
      }
    }
  }, [timeline, width, height]);

  const emitWindow = useCallback((start, end) => {
    const fn = changeRef.current;
    if (typeof fn !== 'function') return;
    if (!(span > 0)) { fn(null); return; }
    let s = Math.max(tStart, Math.min(tEnd, start));
    let e = Math.max(tStart, Math.min(tEnd, end));
    if (e < s) { const tmp = s; s = e; e = tmp; }
    // A window covering the whole span means "no zoom" -> null keeps state clean.
    if (s <= tStart + 1e-9 && e >= tEnd - 1e-9) fn(null);
    else fn({ start: s, end: e });
  }, [span, tStart, tEnd]);

  const zoomAt = useCallback((fraction, factor) => {
    const cur = { a: view.a, b: view.b };
    const w = cur.b - cur.a;
    // Minimum visible window: 1/5000 of the span (about a single bucket).
    const minW = 1 / 5000;
    const nextW = Math.min(1, Math.max(minW, w * factor));
    const center = Math.max(cur.a, Math.min(cur.b, fraction));
    let a = center - (center - cur.a) * (nextW / w);
    let b = a + nextW;
    if (a < 0) { a = 0; b = nextW; }
    if (b > 1) { b = 1; a = 1 - nextW; }
    emitWindow(tStart + a * span, tStart + b * span);
  }, [view, emitWindow, tStart, span]);

  const onWheel = useCallback((e) => {
    if (!(span > 0)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    zoomAt(fraction, e.deltaY > 0 ? 1.25 : 0.8);
  }, [span, zoomAt]);

  const onDoubleClick = useCallback((e) => {
    if (!(span > 0)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    zoomAt(fraction, 0.5);
  }, [span, zoomAt]);

  const onMouseDown = useCallback((e) => {
    if (!(span > 0)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    dragRef.current = {
      startX: e.clientX,
      width: rect.width,
      view: { a: view.a, b: view.b },
      pending: null,
      raf: 0
    };

    const flush = () => {
      const d = dragRef.current;
      if (!d || d.pending == null) return;
      const shift = d.pending;
      d.pending = null;
      let a = d.view.a + shift;
      let b = d.view.b + shift;
      if (a < 0) { b -= a; a = 0; }
      if (b > 1) { a -= (b - 1); b = 1; }
      emitWindow(tStart + a * span, tStart + b * span);
    };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      d.pending = (ev.clientX - d.startX) / d.width;
      if (d.raf) return;
      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
      d.raf = raf(() => { d.raf = 0; flush(); });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const d = dragRef.current;
      if (d && d.raf) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(d.raf); }
      if (d) { d.raf = 0; flush(); }
      dragRef.current = null;
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  }, [span, view, emitWindow, tStart]);

  const reset = useCallback(() => { changeRef.current?.(null); }, []);

  if (!timeline || !timeline.buckets?.length || !(span > 0)) return null;

  const viewStart = tStart + view.a * span;
  const viewEnd = tStart + view.b * span;
  const zoomed = view.a > 1e-6 || view.b < 1 - 1e-6;

  return (
    <div data-testid={testId} style={{ flexShrink: 0 }}>
      <div
        ref={wrapRef}
        className="timeline-overview"
        data-testid={`${testId}-track`}
        role="slider"
        aria-label="时间轴总览"
        aria-valuemin={tStart}
        aria-valuemax={tEnd}
        aria-valuenow={viewStart}
        tabIndex={0}
        style={{ height, cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvasRef} className="timeline-canvas" />
        {view.a > 0 && (
          <div
            className="timeline-dim"
            data-testid={`${testId}-dim-left`}
            style={{ left: 0, width: `${view.a * 100}%` }}
          />
        )}
        {view.b < 1 && (
          <div
            className="timeline-dim"
            data-testid={`${testId}-dim-right`}
            style={{ left: `${view.b * 100}%`, right: 0 }}
          />
        )}
        <div
          className="timeline-brush"
          data-testid={`${testId}-brush`}
          style={{ left: `${view.a * 100}%`, width: `${(view.b - view.a) * 100}%` }}
        />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginTop: 2, fontSize: 11, color: 'var(--text-hint)'
      }}>
        <span>总览 {timeline.total} 帧 · {formatTime(tStart)} ~ {formatTime(tEnd)}</span>
        <span data-testid={`${testId}-window`} style={{ color: 'var(--text-accent)' }}>
          视窗 {formatTime(viewStart)} ~ {formatTime(viewEnd)}
        </span>
        {timeline.topIds?.length > 0 && (
          <span>
            热条 ID：
            {timeline.topIds.slice(0, 3).map(id => (
              idNameMap[id] ? `${idNameMap[id]} ` : `0x${Number(id).toString(16).toUpperCase()} `
            ))}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <Tooltip title="滚轮 / 双击缩放，拖拽平移">
            <ZoomInOutlined />
          </Tooltip>
          <Button
            size="small"
            type="link"
            style={{ padding: 0, height: 'auto', fontSize: 11 }}
            icon={<ExpandOutlined />}
            onClick={reset}
            disabled={!zoomed}
            data-testid={`${testId}-reset`}
          >
            重置
          </Button>
        </span>
      </div>
    </div>
  );
}

export default TimelineOverview;
