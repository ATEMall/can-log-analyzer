import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Table, Tag, Space, Button, Select, Switch, Empty, Typography, Tooltip
} from 'antd';
import {
  DownloadOutlined, WarningOutlined, ThunderboltOutlined
} from '@ant-design/icons';

const { Text } = Typography;

// Canvas needs concrete colours: values mirror the tokens in src/index.css and
// the live values are read back so theme switching keeps working.
const FALLBACK = {
  brand: '#c62828',
  warn: '#faad14',
  faint: '#bfbfbf',
  panel: '#ffffff'
};

const BITRATE_OPTIONS = [
  { value: 125000, label: '125 kbit/s' },
  { value: 250000, label: '250 kbit/s' },
  { value: 500000, label: '500 kbit/s' },
  { value: 1000000, label: '1 Mbit/s' }
];

const KIND_LABELS = {
  stuff: '位填充错误',
  form: '格式错误',
  ack: '应答错误',
  crc: 'CRC 错误',
  bit1: '位错误(显性)',
  bit0: '位错误(隐性)',
  overload: '过载帧',
  other: '其他/未知'
};

const STATE_LABELS = {
  'error-active': 'Error Active',
  'error-passive': 'Error Passive',
  'bus-off': 'Bus Off'
};

const STATE_COLORS = {
  'error-active': 'var(--ok-green)',
  'error-passive': 'var(--warn-gold)',
  'bus-off': 'var(--danger-red)'
};

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

function fmtPct(v) {
  return `${Number(v || 0).toFixed(1)}%`;
}

function fmtMs(v) {
  return `${Number(v || 0).toFixed(2)}`;
}

function fmtTime(t) {
  return Number.isFinite(t) ? `${t.toFixed(3)}s` : '-';
}

/**
 * 逐秒负载率曲线（轻量 canvas，无第三方图表依赖）。
 * 颜色取自主题令牌，深色模式下自动跟随。
 */
function LoadChart({ points, peak, height = 120, testId }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (!ctx) return; // jsdom: nothing to paint

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const brand = readToken('--brand', FALLBACK.brand);
    const warn = readToken('--warn-gold', FALLBACK.warn);
    const faint = readToken('--text-faint', FALLBACK.faint);
    const panel = readToken('--bg-panel', FALLBACK.panel);

    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, width, height);

    // Y grid: 0 / 25 / 50 / 75 / 100 %.
    ctx.strokeStyle = hexToRgba(faint, 0.35);
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = faint;
    for (let g = 0; g <= 4; g++) {
      const y = Math.round((height - 1) * (g / 4));
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
      ctx.fillText(`${100 - g * 25}%`, 2, Math.max(9, y - 2));
    }

    const list = points || [];
    if (list.length === 0) return;

    // Fixed 0-100 % scale keeps the curve comparable across logs; a >100 %
    // bucket (burst) is clamped to the top edge.
    const yOf = (load) => height - Math.min(1, Math.max(0, load / 100)) * (height - 2) - 1;
    const xOf = (i) => (i / Math.max(1, list.length - 1)) * width;

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < list.length; i++) ctx.lineTo(xOf(i), yOf(list[i].load));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(brand, 0.18);
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const x = xOf(i);
      const y = yOf(list[i].load);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = brand;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Peak marker.
    if (Number.isFinite(peak) && peak > 0) {
      const y = yOf(peak);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = warn;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [points, peak, width, height]);

  return (
    <div ref={wrapRef} data-testid={testId} style={{ width: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
    </div>
  );
}

/**
 * R12 (v2.2) — 统计面板：总线负载 / 周期与抖动 / 错误帧与总线状态。
 *
 * 所有数据由主进程聚合后传入（本组件不做任何逐帧计算）：
 *   stats = { load, cycles, errors, totalFrames }
 */
function StatsPanel({
  stats,
  loading = false,
  bitrate = 500000,
  onBitrateChange,
  onJumpToTime,
  onFilterId,
  onExportCSV,
  testId = 'stats-panel'
}) {
  const [overOnly, setOverOnly] = useState(false);

  const load = stats?.load || null;
  const cycles = stats?.cycles || null;
  const errors = stats?.errors || null;

  const rows = useMemo(() => {
    const list = cycles?.rows || [];
    return overOnly ? list.filter(r => (r.overCount || 0) > 0) : list;
  }, [cycles, overOnly]);

  const handleRow = useCallback((record) => {
    if (typeof onFilterId === 'function') onFilterId(record.id, record.firstIndex);
  }, [onFilterId]);

  const span = load ? Math.max(0, load.tEnd - load.tStart) : 0;

  if (!stats) {
    return (
      <div data-testid={testId} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={loading ? '正在统计…' : '加载 ASC/BLF 日志后自动统计总线负载、周期抖动与错误帧'} />
      </div>
    );
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 90,
      render: (id) => (
        <Text code style={{ fontSize: 11, color: 'var(--text-accent)' }}>
          0x{Number(id).toString(16).toUpperCase()}
        </Text>
      )
    },
    {
      title: '消息名',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      ellipsis: true,
      render: (name) => (name
        ? <Tag color="cyan" style={{ fontSize: 11 }}>{name}</Tag>
        : <Text type="secondary" style={{ fontSize: 11 }}>-</Text>)
    },
    {
      title: '帧数',
      dataIndex: 'count',
      key: 'count',
      width: 80,
      align: 'right'
    },
    {
      title: 'DBC周期(ms)',
      dataIndex: 'expected',
      key: 'expected',
      width: 100,
      align: 'right',
      render: (v) => (v == null
        ? <Text type="secondary" style={{ fontSize: 11 }}>-</Text>
        : <Text style={{ fontSize: 11 }}>{fmtMs(v)}</Text>)
    },
    {
      title: '实测均值(ms)',
      dataIndex: 'avgPeriod',
      key: 'avgPeriod',
      width: 100,
      align: 'right',
      render: (v) => <Text style={{ fontSize: 11 }}>{fmtMs(v)}</Text>
    },
    {
      title: '最大抖动(ms)',
      dataIndex: 'maxJitter',
      key: 'maxJitter',
      width: 100,
      align: 'right',
      render: (v) => (
        <Text style={{ fontSize: 11, color: v > 0 ? 'var(--text-accent)' : undefined }}>{fmtMs(v)}</Text>
      )
    },
    {
      title: '超差占比',
      dataIndex: 'overRatio',
      key: 'overRatio',
      width: 100,
      align: 'right',
      render: (v, record) => (
        <Tag
          color={(record.overCount || 0) > 0 ? 'error' : 'default'}
          style={{ fontSize: 11 }}
          data-testid={`stats-over-${record.id}`}
        >
          {fmtPct((v || 0) * 100)}
        </Tag>
      )
    }
  ];

  const errorTotal = errors?.total || 0;
  const busOff = errors?.busOffCount || 0;

  return (
    <div
      data-testid={testId}
      style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 2 }}
    >
      {/* ===== 总览 ===== */}
      <Card size="small" title={<><ThunderboltOutlined /> 总线负载</>} extra={(
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 11 }}>比特率</Text>
          <Select
            size="small"
            value={bitrate}
            options={BITRATE_OPTIONS}
            onChange={onBitrateChange}
            style={{ width: 110 }}
            data-testid="stats-bitrate"
          />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={onExportCSV}
            data-testid="stats-export-csv"
          >
            导出 CSV
          </Button>
        </Space>
      )}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6, fontSize: 12 }}>
          <span>平均负载 <b data-testid="stats-load-avg" style={{ color: 'var(--brand)' }}>{fmtPct(load?.avg)}</b></span>
          <span>峰值负载 <b data-testid="stats-load-peak" style={{ color: 'var(--brand)' }}>{fmtPct(load?.peak)}</b></span>
          <span>峰值时刻 <Text style={{ fontSize: 12 }}>{fmtTime(load?.peakTime)}</Text></span>
          <span>报文总数 <b style={{ color: 'var(--brand)' }}>{stats.totalFrames || 0}</b></span>
          <span>时长 <Text style={{ fontSize: 12 }}>{fmtTime(load?.duration)}</Text></span>
          <span>采样间隔 <Text style={{ fontSize: 12 }}>{load?.interval || 1}s</Text></span>
        </div>
        <LoadChart
          points={load?.points || []}
          peak={load?.peak}
          testId={`${testId}-load-chart`}
        />
      </Card>

      {/* ===== 周期与抖动 ===== */}
      <Card
        size="small"
        title="周期与抖动"
        data-testid={`${testId}-cycle-card`}
        extra={(
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 11 }}>仅看超差</Text>
            <Switch size="small" checked={overOnly} onChange={setOverOnly} data-testid="stats-over-only" />
            <Text type="secondary" style={{ fontSize: 11 }}>
              超差阈值 ±{cycles?.tolerancePct ?? 10}%
            </Text>
          </Space>
        )}
      >
        {rows.length === 0 ? (
          <Empty description="暂无周期统计（需要同一 ID 至少 2 帧）" />
        ) : (
          <Table
            dataSource={rows}
            columns={columns}
            rowKey={(r) => r.id}
            size="small"
            pagination={false}
            scroll={{ y: 220, x: 720 }}
            onRow={(record) => ({
              onClick: () => handleRow(record),
              'data-testid': `stats-cycle-row-${record.id}`,
              style: { cursor: 'pointer' }
            })}
            rowClassName={() => 'stats-cycle-row'}
          />
        )}
      </Card>

      {/* ===== 错误帧 / 总线状态 ===== */}
      <Card
        size="small"
        title={<><WarningOutlined style={{ color: errorTotal > 0 ? 'var(--danger-red)' : undefined }} /> 错误帧与总线状态</>}
        data-testid={`${testId}-error-card`}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
          <span>
            错误帧总数{' '}
            <Tag color={errorTotal > 0 ? 'error' : 'default'} data-testid={`${testId}-error-total`}>
              {errorTotal}
            </Tag>
          </span>
          <span>
            Bus Off{' '}
            <Tag color={busOff > 0 ? 'error' : 'default'} data-testid={`${testId}-busoff-count`}>
              {busOff}
            </Tag>
          </span>
          {(errors?.byKind || []).map(k => (
            <Tag key={k.kind} color="volcano" style={{ fontSize: 11 }}>
              {KIND_LABELS[k.kind] || k.kind}: {k.count}
            </Tag>
          ))}
          {errorTotal === 0 && busOff === 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>当前日志未记录错误帧</Text>
          )}
        </div>

        {/* 状态时间线：Error Active / Passive / Bus Off 标记 */}
        <div
          data-testid={`${testId}-state-timeline`}
          style={{
            position: 'relative', height: 22, marginBottom: 8,
            border: '1px solid var(--border-strong)', borderRadius: 4,
            background: 'var(--bg-well)'
          }}
        >
          {(errors?.states || []).map((st, i) => {
            const frac = span > 0 ? Math.min(1, Math.max(0, (Number(st.timestamp) - load.tStart) / span)) : 0;
            return (
              <Tooltip key={`${st.timestamp}-${i}`} title={`${fmtTime(st.timestamp)} ${STATE_LABELS[st.state] || st.state}`}>
                <span
                  data-testid={`${testId}-state-marker-${i}`}
                  style={{
                    position: 'absolute', top: 2, bottom: 2, width: 3,
                    left: `calc(${frac * 100}% - 1px)`,
                    background: STATE_COLORS[st.state] || 'var(--brand)',
                    borderRadius: 2
                  }}
                />
              </Tooltip>
            );
          })}
        </div>

        {/* 错误帧明细（点击跳转报文表对应时刻） */}
        {(errors?.events || []).slice(0, 20).map((e, i) => (
          <Button
            key={`${e.timestamp}-${i}`}
            size="small"
            type="link"
            style={{ padding: '0 6px 0 0', fontSize: 11, height: 20 }}
            onClick={() => onJumpToTime && onJumpToTime(Number(e.timestamp))}
            data-testid={`${testId}-error-event-${i}`}
          >
            {fmtTime(Number(e.timestamp))} · {KIND_LABELS[e.category] || '其他/未知'}
          </Button>
        ))}
        {errorTotal > (errors?.events || []).length && (
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            仅显示前 {(errors?.events || []).length} 条（共 {errorTotal} 条）
          </Text>
        )}
      </Card>
    </div>
  );
}

export default StatsPanel;
