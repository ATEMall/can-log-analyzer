import React, { useMemo } from 'react';
import { Tooltip, Empty } from 'antd';

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
    // Motorola (big-endian): sawtooth pattern
    let p = startBit;
    for (let i = 0; i < length; i++) {
      cells.push([Math.floor(p / 8), 7 - (p % 8)]);
      if ((p % 8) === 0) p += 15; else p--;
    }
  }
  return cells;
}

function SignalLayoutView({ message, selectedSignalNames = [], onSignalToggle, compact = false }) {
  const signals = message?.signals || [];

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

  const cellSize = compact ? 22 : 28;

  // Determine how many byte rows to render. Prefer the message's declared
  // DLC (e.g. 8 for classic CAN, 12/16/20/24/32/48/64 for CAN FD) and fall
  // back to the highest byte index actually occupied by any signal.
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

  const renderGrid = () => {
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

    // Byte rows: B0 (top) -> B(totalBytes-1) (bottom), each row holds bits 0-7
    for (let byte = 0; byte < totalBytes; byte++) {
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
          fontSize: sigName && isFirst ? (compact ? 8 : 9) : 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          cursor: sigName ? 'pointer' : 'default',
          background: sigName ? color : 'transparent',
          opacity: sigName ? (selected ? 1 : 0.35) : 1,
          border: sigName ? (selected ? `2px solid ${color}` : '1px solid rgba(0,0,0,0.15)') : '1px solid rgba(0,0,0,0.06)',
          borderRadius: 3,
          color: '#fff',
          fontWeight: sigName && isFirst ? 700 : 400,
          boxSizing: 'border-box'
        };

        let inner = '';
        if (sigName) {
          inner = isFirst ? (sigName.length > 4 ? sigName.slice(0, 3) + '.' : sigName) : '·';
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

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {renderGrid()}
      </div>
      {/* Legend */}
      <div style={{
        marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
        borderTop: '1px solid #f0f0f0', paddingTop: 8
      }}>
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
                  borderRadius: 4, padding: '1px 4px'
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
  );
}

export default SignalLayoutView;
