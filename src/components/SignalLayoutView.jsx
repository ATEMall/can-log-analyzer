import React, { useMemo, useState } from 'react';
import { Tooltip, Empty, Modal, Button, Space } from 'antd';
import { FullscreenOutlined } from '@ant-design/icons';

const PALETTE = [
  '#1890ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96',
  '#13c2c2', '#f5222d', '#2f54eb', '#a0d911', '#faad14',
  '#531dab', '#08979c', '#c41d7f', '#389e0d', '#d46b08'
];

/**
 * Compute the [byteIdx, bitIdx] grid position for every bit of a signal.
 * bitIdx 0 = LSB (bottom of the cell column), 7 = MSB (top).
 * Follows the exact same numbering as the decoder in electron/main.js.
 */
function signalBitCells(signal) {
  const { startBit, length, byteOrder } = signal;
  const cells = [];
  if (byteOrder === 'little') {
    let p = startBit;
    for (let i = 0; i < length; i++) {
      cells.push([Math.floor(p / 8), p % 8]);
      p++;
    }
  } else {
    // Motorola (big-endian): DBC (Vector) bit numbering — byte n's MSB is bit
    // number 8n+7, LSB is 8n. startBit = signal MSB (aligned signals start at
    // 7/15/23/31/...). Sawtooth walk: MSB->LSB within a byte, +15 jump at byte
    // boundaries (same semantics as the decoder in dbc.js).
    let p = startBit;
    for (let i = 0; i < length; i++) {
      cells.push([Math.floor(p / 8), p % 8]);
      if ((p % 8) === 0) p += 15; else p--;
    }
  }
  return cells;
}

function SignalLayoutView({ message, selectedSignalNames = [], onSignalToggle, compact = false }) {
  const signals = message?.signals || [];
  const [modalOpen, setModalOpen] = useState(false);

  const colorMap = useMemo(() => {
    const m = {};
    signals.forEach((s, i) => { m[s.name] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [signals]);

  // cellKey "byte-bit" -> signal names occupying it
  const cellMap = useMemo(() => {
    const m = {};
    signals.forEach(s => {
      signalBitCells(s).forEach(([b, bit]) => {
        const key = `${b}-${bit}`;
        if (!m[key]) m[key] = [];
        m[key].push(s.name);
      });
    });
    return m;
  }, [signals]);

  // first cell of each signal (for showing the name label)
  const firstCellMap = useMemo(() => {
    const m = {};
    signals.forEach(s => {
      const cells = signalBitCells(s);
      if (cells.length > 0) {
        const [b, bit] = cells[0];
        m[`${b}-${bit}`] = m[`${b}-${bit}`] || s.name;
      }
    });
    return m;
  }, [signals]);

  if (signals.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="请选择一条消息查看信号布局"
        style={{ padding: 24 }}
      />
    );
  }

  // Total number of bytes in the message. The embedded grid only shows the
  // first MAX_INLINE_BYTES of them; the rest are reachable via the modal.
  const totalBytes = (() => {
    const dlc = Number(message?.dlc) || 0;
    let sigMax = 0;
    for (const s of signals) {
      const cells = signalBitCells(s);
      for (const [b] of cells) {
        if (b + 1 > sigMax) sigMax = b + 1;
      }
    }
    return Math.max(dlc, sigMax, 1);
  })();

  // Pick a cell size based on totalBytes (and modal size for the popup).
  const MAX_INLINE_BYTES = 8;
  const pickCellSize = (bytes, isModal) => {
    if (isModal) {
      // Modal has plenty of room — keep cells large and readable.
      return bytes <= 8 ? 32 : bytes <= 16 ? 28 : bytes <= 32 ? 22 : 18;
    }
    if (compact) {
      if (bytes <= 8) return 22;
      if (bytes <= 16) return 18;
      return 14;
    }
    if (bytes <= 8) return 28;
    if (bytes <= 16) return 22;
    return 16;
  };

  // Render the byte grid for a given visible range. Shared between the
  // embedded grid (always capped to MAX_INLINE_BYTES) and the modal (full
  // message), so styling stays consistent across both views.
  const renderGrid = (visibleEnd, isModal) => {
    const cellSize = pickCellSize(visibleEnd, isModal);
    const labelFontSize = cellSize >= 22 ? 11 : cellSize >= 18 ? 10 : 9;
    const dotFontSize = cellSize >= 22 ? 10 : cellSize >= 18 ? 9 : 8;

    const rows = [];
    // Column header row: bit 0 (left) -> bit 7 (right)
    const headerCells = [<div key="corner" style={{ width: 36 }} />];
    for (let bit = 0; bit < 8; bit++) {
      headerCells.push(
        <div key={`h${bit}`} style={{
          width: cellSize, textAlign: 'center',
          fontSize: 10, color: '#8c8c8c', fontWeight: 600
        }}>
            {bit}
        </div>
      );
    }
    rows.push(
      <div key="header" style={{ display: 'flex', gap: 1, marginBottom: 2 }}>
        {headerCells}
      </div>
    );

    for (let byte = 0; byte < visibleEnd; byte++) {
      const rowCells = [
        <div key={`l${byte}`} style={{
          width: 36, fontSize: 10, color: '#8c8c8c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 600
        }}>
          B{byte}
        </div>
      ];
      for (let bit = 0; bit < 8; bit++) {
        const key = `${byte}-${bit}`;
        const sigNames = cellMap[key] || [];
        const sigName = sigNames[0];
        const isFirst = firstCellMap[key] === sigName;
        const color = sigName ? colorMap[sigName] : undefined;
        const selected = sigName ? selectedSignalNames.includes(sigName) : false;

        const cellStyle = {
          width: cellSize,
          height: cellSize,
          fontSize: sigName && isFirst ? labelFontSize : dotFontSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          cursor: sigName ? 'pointer' : 'default',
          background: sigName ? color : 'transparent',
          opacity: sigName ? (selected ? 1 : 0.35) : 1,
          border: sigName ? (selected ? `2px solid ${color}` : '1px solid rgba(0,0,0,0.15)') : '1px solid rgba(0,0,0,0.06)',
          borderRadius: 2,
          color: '#fff',
          fontWeight: sigName && isFirst ? 700 : 400,
          boxSizing: 'border-box'
        };

        let inner = '';
        if (sigName) {
          if (!isFirst) {
            inner = '·';
          } else if (cellSize >= 16) {
            inner = sigName.length > (cellSize >= 28 ? 6 : 4)
              ? sigName.slice(0, (cellSize >= 28 ? 5 : 3)) + '.'
              : sigName;
          } else {
            inner = sigName.charAt(0);
          }
        }

        const tooltip = sigName
          ? `${sigName}  [bit ${byte * 8 + bit}]`
          : '';

        const cell = (
          <div
            key={key}
            style={cellStyle}
            onClick={sigName && onSignalToggle ? () => onSignalToggle(sigName) : undefined}
          >
            {inner}
          </div>
        );

        if (tooltip) {
          rowCells.push(
            <Tooltip key={key} title={tooltip} mouseEnterDelay={0.4}>{cell}</Tooltip>
          );
        } else {
          rowCells.push(cell);
        }
      }
      rows.push(
        <div key={`row${byte}`} style={{ display: 'flex', gap: 1, marginBottom: 1 }}>
          {rowCells}
        </div>
      );
    }
    return rows;
  };

  const inlineVisibleEnd = Math.min(totalBytes, MAX_INLINE_BYTES);
  const hasMoreBytes = totalBytes > MAX_INLINE_BYTES;

  return (
    <div>
      {/* Grid wrapper: embedded view is capped to the first 8 byte rows to keep
          the panel compact; the rest are available in the modal opened via the
          "查看全部" button below. */}
      <div data-testid="layout-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {renderGrid(inlineVisibleEnd, false)}
        </div>
        {hasMoreBytes && (
          <div style={{ fontSize: 10, color: '#999', marginTop: 4, textAlign: 'right' }}>
            已显示前 {MAX_INLINE_BYTES} 字节（共 {totalBytes} 字节）
          </div>
        )}
      </div>
      {hasMoreBytes && (
        <div style={{ marginTop: 6, textAlign: 'right' }}>
          <Button
            type="link"
            size="small"
            icon={<FullscreenOutlined />}
            onClick={() => setModalOpen(true)}
            data-testid="open-layout-modal"
          >
            弹窗查看全部 {totalBytes} 字节
          </Button>
        </div>
      )}
      {/* Endianness legend (R1: signal layout must be read with the same
          semantics as the decoder). */}
      <div
        data-testid="endian-legend"
        style={{
          marginBottom: 6,
          fontSize: 11,
          color: '#8c8c8c',
          display: 'flex',
          gap: '4px 16px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}
      >
        <span>
          <b>Intel(小端)</b>：位号从 startBit 线性递增，字节内 LSB→MSB，跨字节连续
        </span>
        <span>
          <b>Motorola(大端)</b>：startBit 为信号最高位(MSB)，位号锯齿遍历——字节内 MSB→LSB，到字节边界跳至下一字节 MSB（对齐信号 startBit=7/15/23/…）
        </span>
      </div>
      {/* Legend - one row of chips that scrolls horizontally so every signal is
          always reachable, no matter how many signals the message defines. */}
      <div style={{
        marginTop: 10,
        borderTop: '1px solid #f0f0f0', paddingTop: 8
      }}>
        <div
          data-testid="legend-list"
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            gap: '4px 12px',
            overflowX: 'auto',
            paddingBottom: 4
          }}
        >
          {signals.map(s => {
            const color = colorMap[s.name];
            const selected = selectedSignalNames.includes(s.name);
            return (
              <Tooltip key={s.name}
                title={`${s.name}: startBit ${s.startBit}, ${s.length} bit, ${s.byteOrder === 'little' ? 'Intel' : 'Motorola'}, 缩放 ${s.factor}, 偏移 ${s.offset}`}>
                <span
                  onClick={onSignalToggle ? () => onSignalToggle(s.name) : undefined}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, cursor: onSignalToggle ? 'pointer' : 'default',
                    opacity: selected ? 1 : 0.4,
                    border: selected ? `1px solid ${color}` : '1px solid transparent',
                    borderRadius: 4, padding: '1px 4px',
                    flexShrink: 0
                  }}
                >
                  <span style={{
                    width: 10, height: 10, background: color,
                    display: 'inline-block', borderRadius: 2, flexShrink: 0
                  }} />
                  {s.name}
                  <span style={{ color: '#999' }}>{s.startBit}|{s.length}@{s.byteOrder === 'little' ? '1' : '0'}</span>
                </span>
              </Tooltip>
            );
          })}
        </div>
      </div>
      {/* Full-frame modal: opened by the link button above. Uses the same grid
          renderer but with a larger cellSize and the full byte range. */}
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width="80%"
        title={
          <Space>
            <span>信号位布局图</span>
            <span style={{ color: '#999', fontWeight: 400 }}>
              {message?.name} · {totalBytes} 字节 · {signals.length} 信号
            </span>
          </Space>
        }
        destroyOnHidden
      >
        <div
          data-testid="layout-grid-modal"
          style={{
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            padding: 16,
            maxHeight: '70vh',
            overflow: 'auto'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {renderGrid(totalBytes, true)}
          </div>
          {/* Same legend in the modal so signal colors stay anchored. */}
          <div style={{
            marginTop: 14,
            borderTop: '1px solid #f0f0f0',
            paddingTop: 10
          }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px 14px'
              }}
            >
              {signals.map(s => {
                const color = colorMap[s.name];
                const selected = selectedSignalNames.includes(s.name);
                return (
                  <Tooltip key={s.name}
                    title={`${s.name}: startBit ${s.startBit}, ${s.length} bit, ${s.byteOrder === 'little' ? 'Intel' : 'Motorola'}, 缩放 ${s.factor}, 偏移 ${s.offset}`}>
                    <span
                      onClick={onSignalToggle ? () => onSignalToggle(s.name) : undefined}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 12, cursor: onSignalToggle ? 'pointer' : 'default',
                        opacity: selected ? 1 : 0.4,
                        border: selected ? `1px solid ${color}` : '1px solid transparent',
                        borderRadius: 4, padding: '2px 6px'
                      }}
                    >
                      <span style={{
                        width: 12, height: 12, background: color,
                        display: 'inline-block', borderRadius: 2, flexShrink: 0
                      }} />
                      {s.name}
                      <span style={{ color: '#999' }}>{s.startBit}|{s.length}@{s.byteOrder === 'little' ? '1' : '0'}</span>
                    </span>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default SignalLayoutView;
