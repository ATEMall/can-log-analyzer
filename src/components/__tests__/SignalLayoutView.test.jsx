import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('caps the embedded grid at 8 byte rows even for a 64-byte CAN FD message', () => {
    const { container } = render(<SignalLayoutView message={msg64} />);
    // B0..B7 always visible inline
    expect(screen.getByText('B0')).toBeTruthy();
    expect(screen.getByText('B7')).toBeTruthy();
    // Bytes past B7 are NOT rendered inline — they live behind the modal.
    expect(screen.queryByText('B30')).toBeNull();
    expect(screen.queryByText('B55')).toBeNull();
    expect(screen.queryByText('B63')).toBeNull();
    // The hint copy explains the cap so users know where the rest went.
    expect(container.textContent).toMatch(/已显示前 8 字节/);
    // The "open modal" button is rendered when there is more to show.
    const openBtn = screen.getByTestId('open-layout-modal');
    expect(openBtn).toBeTruthy();
    expect(openBtn.textContent).toMatch(/64/);
  });

  it('does not show the modal button when the message already fits in 8 bytes', () => {
    render(<SignalLayoutView message={msg8} />);
    expect(screen.queryByTestId('open-layout-modal')).toBeNull();
  });

  it('renders exactly 8 rows for an 8-byte classic message', () => {
    render(<SignalLayoutView message={msg8} />);
    expect(screen.getByText('B0')).toBeTruthy();
    expect(screen.getByText('B7')).toBeTruthy();
    expect(screen.queryByText('B8')).toBeNull();
    expect(screen.queryByText('B63')).toBeNull();
  });

  it('shows an empty state when no message is selected', () => {
    render(<SignalLayoutView message={null} />);
    expect(screen.getByText(/请选择一条消息查看信号布局/i)).toBeTruthy();
  });

  it('renders every signal in the legend as a horizontally-scrolling row', () => {
    // 12 signals on a small message — every chip must be in the DOM, reachable
    // via horizontal scroll, instead of being hidden behind a +N cap.
    const sigs = Array.from({ length: 12 }, (_, i) => ({
      name: `Sig_${i.toString().padStart(2, '0')}`,
      startBit: i * 8,
      length: 8,
      byteOrder: 'little',
      factor: 1,
      offset: 0
    }));
    const { container } = render(
      <SignalLayoutView message={{ id: 1, name: 'M', dlc: 8, signals: sigs }} />
    );
    // The legend list scrolls horizontally instead of wrapping
    const legend = container.querySelector('[data-testid="legend-list"]');
    expect(legend).toBeTruthy();
    const style = legend.getAttribute('style') || '';
    expect(style).toMatch(/overflow-x:\s*auto/i);
    expect(style).toMatch(/flex-wrap:\s*nowrap/i);
    // Each signal name appears in the legend's text content. The chips live
    // inline (no separators), so substring matching against the rendered text
    // is sufficient — any missing name will fail this assertion.
    const legendText = legend.textContent;
    for (let i = 0; i < 12; i++) {
      const label = `Sig_${i.toString().padStart(2, '0')}`;
      expect(legendText).toContain(label);
    }
    // Legacy +N hint is gone
    expect(screen.queryByTestId('legend-overflow')).toBeNull();
  });

  it('modal renders every byte row of a 64-byte CAN FD message once opened', () => {
    render(<SignalLayoutView message={msg64} />);
    // Click the "查看全部" button — modal mounts in-place (no portal escape).
    const openBtn = screen.getByTestId('open-layout-modal');
    fireEvent.click(openBtn);
    // Now the modal grid is in the document and B0..B63 are all present
    // inside it. Use scoped queries to disambiguate from the inline grid.
    const modal = screen.getByTestId('layout-grid-modal');
    expect(modal).toBeTruthy();
    for (const label of ['B0', 'B7', 'B30', 'B55', 'B63']) {
      const inModal = Array.from(modal.querySelectorAll('*')).some(
        el => el.children.length === 0 && el.textContent.trim() === label
      );
      expect(inModal).toBe(true);
    }
    const b64 = Array.from(modal.querySelectorAll('*')).some(
      el => el.children.length === 0 && el.textContent.trim() === 'B64'
    );
    expect(b64).toBe(false);
  });
});
