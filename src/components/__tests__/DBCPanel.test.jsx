import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DBCPanel from '../DBCPanel';

// 30+ signals on a single 64-byte message, simulating the CAN FD rich example
// where the inline signal list easily exceeds the available vertical space.
const longMsg = {
  id: 256,
  name: 'VCU_STATE',
  dlc: 64,
  sender: 'VCU',
  signals: Array.from({ length: 42 }, (_, i) => ({
    name: `Sig_${i.toString().padStart(2, '0')}`,
    startBit: i * 8,
    length: 8,
    byteOrder: 'little',
    factor: 1,
    offset: 0,
    receivers: ['BMS']
  }))
};

const baseProps = {
  messages: [longMsg],
  selectedSignals: [],
  dbcRawContent: 'BO_ 256 VCU_STATE: 64 VCU',
  onSignalToggle: vi.fn(),
  onSignalSelectAll: vi.fn(),
  onSignalClearAll: vi.fn(),
  onMsgSignalSelectAll: vi.fn(),
  onMsgSignalClearAll: vi.fn(),
  onLoadDBC: vi.fn(),
  onViewRaw: vi.fn(),
  dbcLoaded: true
};

describe('DBCPanel', () => {
  it('shows an explicit 清空 button in the header next to DBC 原文', () => {
    render(<DBCPanel {...baseProps} />);
    // Both buttons live in the same header row and both should always be present.
    expect(screen.getByRole('button', { name: /清空/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /DBC 原文/ })).toBeTruthy();
  });

  it('the 清空 button is disabled when the search box is empty', () => {
    render(<DBCPanel {...baseProps} />);
    const btn = screen.getByRole('button', { name: /清空/ });
    expect(btn.disabled).toBe(true);
  });

  it('clicking 清空 resets the search input value', () => {
    render(<DBCPanel {...baseProps} />);
    const input = screen.getByPlaceholderText(/检索消息名/);
    fireEvent.change(input, { target: { value: 'Speed' } });
    expect(input.value).toBe('Speed');

    const btn = screen.getByRole('button', { name: /清空/ });
    fireEvent.click(btn);
    expect(input.value).toBe('');
  });

  it('search input no longer renders an in-field clear (allowClear is removed)', () => {
    const { container } = render(<DBCPanel {...baseProps} />);
    // antd's allowClear puts a span.ant-input-clear-icon inside .ant-input-affix-wrapper.
    // Once the clear action moves to the header button, this class must be gone so
    // the old X icon can no longer be hidden behind other rows.
    expect(container.querySelector('.ant-input-clear-icon')).toBeNull();
  });

  it('caps the inline signal list height with a vertical scrollbar', () => {
    const { container } = render(<DBCPanel {...baseProps} />);
    // Expand the long message by clicking its header twice (first selects, second expands).
    const msgHeader = screen.getByText('VCU_STATE');
    fireEvent.click(msgHeader);

    // The wrapper around the inline signal rows must report a maxHeight and
    // overflowY so the long list scrolls inside the panel.
    const scrollable = container.querySelector('[data-testid="dbc-msg-signals"]');
    if (scrollable) {
      const style = scrollable.getAttribute('style') || '';
      expect(style).toMatch(/max-height:\s*240/i);
      expect(style).toMatch(/overflow-y:\s*auto/i);
    } else {
      // Fallback: find any div whose computed style caps height for the signal list.
      const all = container.querySelectorAll('div[style*="max-height"]');
      const found = Array.from(all).some(el => /overflow-y:\s*auto/.test(el.getAttribute('style') || ''));
      expect(found).toBe(true);
    }
  });
});
