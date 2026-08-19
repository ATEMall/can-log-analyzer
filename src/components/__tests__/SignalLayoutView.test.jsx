import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignalLayoutView from '../SignalLayoutView';

// A 64-byte message with signals spread across the whole range (B0..B63).
const msg64 = {
  id: 256,
  name: 'VCU_STATE',
  dlc: 64,
  signals: [
    { name: 'VehicleSpeed', startBit: 0, length: 16, byteOrder: 'little', factor: 0.01, offset: 0 },
    { name: 'Odometer', startBit: 240, length: 32, byteOrder: 'little', factor: 0.001, offset: 0 },
    { name: 'PackVoltage', startBit: 440, length: 16, byteOrder: 'little', factor: 0.01, offset: 0 },
    { name: 'CellTempMax', startBit: 504, length: 8, byteOrder: 'little', factor: 1, offset: 0 }
  ]
};

// A classic 8-byte message.
const msg8 = {
  id: 512,
  name: 'ENGINE',
  dlc: 8,
  signals: [
    { name: 'RPM', startBit: 0, length: 16, byteOrder: 'little', factor: 1, offset: 0 }
  ]
};

describe('SignalLayoutView', () => {
  it('renders B0..B63 rows for a 64-byte CAN FD message', () => {
    render(<SignalLayoutView message={msg64} />);
    expect(screen.getByText('B0')).toBeTruthy();
    expect(screen.getByText('B7')).toBeTruthy();
    expect(screen.getByText('B30')).toBeTruthy();   // Odometer start byte
    expect(screen.getByText('B55')).toBeTruthy();   // PackVoltage start byte
    expect(screen.getByText('B63')).toBeTruthy();   // CellTempMax start byte
    expect(screen.queryByText('B64')).toBeNull();   // no out-of-range row
  });

  it('renders exactly 8 rows for an 8-byte classic message', () => {
    render(<SignalLayoutView message={msg8} />);
    expect(screen.getByText('B0')).toBeTruthy();
    expect(screen.getByText('B7')).toBeTruthy();
    expect(screen.queryByText('B8')).toBeNull();
    expect(screen.queryByText('B63')).toBeNull();
  });

  it('falls back to the highest occupied byte when DLC is missing', () => {
    const noDlc = { ...msg64, dlc: undefined };
    render(<SignalLayoutView message={noDlc} />);
    // CellTempMax occupies B63 (startBit 504..511), so B63 must render
    expect(screen.getByText('B63')).toBeTruthy();
  });

  it('shows an empty state when no message is selected', () => {
    render(<SignalLayoutView message={null} />);
    expect(screen.getByText(/请选择一条消息查看信号布局/i)).toBeTruthy();
  });
});
