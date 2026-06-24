import React, { useState, useMemo, useCallback } from 'react';
import {
  Button, Input, Checkbox, Empty, Space, Tag, message, Table, Tooltip, Card, Divider
} from 'antd';
import {
  ThunderboltOutlined, DownloadOutlined, SearchOutlined,
  LineChartOutlined, TableOutlined
} from '@ant-design/icons';

const CHART_COLORS = [
  '#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1',
  '#13c2c2', '#f5222d', '#a0d911', '#2f54eb', '#fa541c'
];

// ---- Dependency-free multi-signal SVG line chart (downsampled, shared time axis) ----
function SignalChart({ rows, signals }) {
  const W = 900, H = 320, padL = 56, padR = 16, padT = 16, padB = 28;
  const numericSignals = useMemo(
    () => signals.filter(s => rows.some(r => typeof r[s] === 'number')),
    [rows, signals]
  );

  const series = useMemo(() => {
    const MAX_PTS = 1500;
    const step = Math.max(1, Math.floor(rows.length / MAX_PTS));
    const sampled = rows.filter((_, i) => i % step === 0);
    let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const r of sampled) {
      if (r.t < tMin) tMin = r.t; if (r.t > tMax) tMax = r.t;
      for (const s of numericSignals) {
        const v = r[s];
        if (typeof v === 'number') { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
      }
    }
    if (!isFinite(vMin)) { vMin = 0; vMax = 1; }
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    if (tMin === tMax) { tMax = tMin + 1; }
    return { sampled, tMin, tMax, vMin, vMax };
  }, [rows, numericSignals]);

  if (!numericSignals.length || !rows.length) {
    return <Empty description="无可绘制的数值信号（枚举/字符信号不绘制曲线）" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const { sampled, tMin, tMax, vMin, vMax } = series;
  const sx = t => padL + ((t - tMin) / (tMax - tMin)) * (W - padL - padR);
  const sy = v => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);

  const yTicks = 5;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => vMin + (i / yTicks) * (vMax - vMin));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6 }}>
        {yVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="#eee" />
            <text x={padL - 6} y={sy(v) + 4} textAnchor="end" fontSize="10" fill="#999">
              {Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={padL} y={H - 8} fontSize="10" fill="#999">{tMin.toFixed(3)}s</text>
        <text x={W - padR} y={H - 8} textAnchor="end" fontSize="10" fill="#999">{tMax.toFixed(3)}s</text>
        {numericSignals.map((s, si) => {
          const pts = [];
          for (const r of sampled) {
            if (typeof r[s] === 'number') pts.push(`${sx(r.t).toFixed(1)},${sy(r[s]).toFixed(1)}`);
          }
          return <polyline key={s} fill="none" stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth="1.4" points={pts.join(' ')} />;
        })}
      </svg>
      <div style={{ marginTop: 8 }}>
        <Space wrap>
          {numericSignals.map((s, si) => (
            <span key={s} style={{ fontSize: 12, color: '#555' }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                background: CHART_COLORS[si % CHART_COLORS.length], marginRight: 4, verticalAlign: 'middle'
              }} />
              {s}
            </span>
          ))}
        </Space>
      </div>
    </div>
  );
}

export default function SignalDecodeTab({ dbcMessages, loadedMessages }) {
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [decoded, setDecoded] = useState(null); // { rows, signals }
  const [loading, setLoading] = useState(false);

  // Flatten signals, apply search filter (by signal or message name)
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = [];
    for (const m of dbcMessages) {
      const sigs = m.signals.filter(s =>
        !q || s.name.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      );
      if (sigs.length) out.push({ msg: m, sigs });
    }
    return out;
  }, [dbcMessages, search]);

  const visibleKeys = useMemo(() => {
    const ks = [];
    for (const g of groups) for (const s of g.sigs) ks.push(`${g.msg.id}::${s.name}`);
    return ks;
  }, [groups]);

  const toggle = useCallback((key) => {
    setSelectedKeys(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }, []);

  const selectAllVisible = useCallback((checked) => {
    setSelectedKeys(prev => {
      const n = new Set(prev);
      visibleKeys.forEach(k => checked ? n.add(k) : n.delete(k));
      return n;
    });
  }, [visibleKeys]);

  const handleDecode = useCallback(async () => {
    if (!loadedMessages?.length) { message.warning('请先加载 ASC / BLF 日志文件'); return; }
    if (!selectedKeys.size) { message.warning('请至少勾选一个信号'); return; }
    setLoading(true);
    try {
      const frames = loadedMessages.map(m => ({ timestamp: m.timestamp, id: m.id, data: m.data }));
      const res = await window.electronAPI.decodeSignals(frames, dbcMessages, Array.from(selectedKeys));
      if (res.success) {
        setDecoded({ rows: res.rows, signals: res.signals });
        message.success(`解码完成：${res.totalRows} 行 × ${res.signals.length} 信号`);
      } else {
        message.error('解码失败: ' + res.error);
      }
    } catch (e) {
      message.error('解码失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages, dbcMessages, selectedKeys]);

  const handleExportCSV = useCallback(async () => {
    if (!decoded?.rows?.length) { message.warning('没有可导出的解码结果'); return; }
    const cols = ['t', ...decoded.signals];
    const head = cols.join(',');
    const body = decoded.rows.map(r => cols.map(c => (c in r ? r[c] : '')).join(',')).join('\n');
    const csv = head + '\n' + body;
    const filePath = await window.electronAPI.saveFile(`decoded_${Date.now()}.csv`, [
      { name: 'CSV Files', extensions: ['csv'] }
    ]);
    if (!filePath) return;
    const res = await window.electronAPI.saveText(filePath, csv);
    res.success ? message.success('CSV 已导出') : message.error('导出失败: ' + res.error);
  }, [decoded]);

  const tableData = useMemo(() => {
    if (!decoded) return [];
    return decoded.rows.slice(0, 5000).map((r, i) => ({ key: i, ...r }));
  }, [decoded]);

  const tableColumns = useMemo(() => {
    if (!decoded) return [];
    return [
      { title: '时间(s)', dataIndex: 't', key: 't', width: 120, fixed: 'left',
        render: v => (typeof v === 'number' ? v.toFixed(6) : v) },
      ...decoded.signals.map(s => ({
        title: s, dataIndex: s, key: s, width: 140,
        render: v => (typeof v === 'number' ? (Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4) ? v.toExponential(3) : +v.toFixed(4)) : v)
      }))
    ];
  }, [decoded]);

  if (!dbcMessages.length) {
    return <Empty description="请先在左侧加载 DBC 文件，再选择信号进行解析" style={{ marginTop: 60 }} />;
  }

  const selectedCount = selectedKeys.size;

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      {/* Left: signal picker */}
      <Card
        size="small"
        title={<span><LineChartOutlined /> 选择信号 <Tag color="blue">{selectedCount} 已选</Tag></span>}
        style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ padding: 8, overflow: 'auto', flex: 1, minHeight: 0 }}
      >
        <Input
          allowClear prefix={<SearchOutlined />} placeholder="搜索信号名 / 报文名"
          value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }}
        />
        <Space style={{ marginBottom: 8 }}>
          <Button size="small" onClick={() => selectAllVisible(true)}>全选(当前)</Button>
          <Button size="small" onClick={() => selectAllVisible(false)}>清除(当前)</Button>
          <Button size="small" danger onClick={() => setSelectedKeys(new Set())}>清空全部</Button>
        </Space>
        <div>
          {groups.map(g => (
            <div key={g.msg.id} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#555', borderBottom: '1px solid #f0f0f0', paddingBottom: 2 }}>
                {g.msg.name} <span style={{ color: '#aaa' }}>(0x{g.msg.id.toString(16).toUpperCase()})</span>
              </div>
              {g.sigs.map(s => {
                const key = `${g.msg.id}::${s.name}`;
                return (
                  <div key={key} style={{ padding: '2px 0 2px 6px' }}>
                    <Checkbox checked={selectedKeys.has(key)} onChange={() => toggle(key)}>
                      <span style={{ fontSize: 13 }}>{s.name}</span>
                      <span style={{ fontSize: 11, color: '#aaa', marginLeft: 6 }}>
                        {s.byteOrder === 'little' ? 'Intel' : 'Motorola'} · {s.length}b{s.unit ? ' · ' + s.unit : ''}
                        {s.muxIndicator ? ' · mux' : ''}{s.valueDefs ? ' · enum' : ''}
                      </span>
                    </Checkbox>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      {/* Right: actions + chart + table */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={handleDecode}>
            解码所选信号
          </Button>
          <Button icon={<DownloadOutlined />} disabled={!decoded?.rows?.length} onClick={handleExportCSV}>
            导出 CSV
          </Button>
          <Tooltip title="已加载日志帧数">
            <Tag>{loadedMessages?.length || 0} 帧</Tag>
          </Tooltip>
          {decoded && <Tag color="green">{decoded.rows.length} 行结果</Tag>}
        </Space>

        {!decoded ? (
          <Empty description="勾选信号后点击「解码所选信号」" style={{ marginTop: 40 }} />
        ) : (
          <>
            <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
              <LineChartOutlined /> 信号曲线
            </Divider>
            <SignalChart rows={decoded.rows} signals={decoded.signals} />
            <Divider orientation="left" plain style={{ margin: '16px 0 8px' }}>
              <TableOutlined /> 解析结果{decoded.rows.length > 5000 ? '（表格仅显示前 5000 行，导出 CSV 获取全部）' : ''}
            </Divider>
            <Table
              size="small"
              columns={tableColumns}
              dataSource={tableData}
              scroll={{ x: 'max-content', y: 320 }}
              pagination={{ pageSize: 50, showSizeChanger: true }}
            />
          </>
        )}
      </div>
    </div>
  );
}
