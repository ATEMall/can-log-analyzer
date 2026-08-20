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
  it('renders a 清空 button in the header next to DBC 原文', () => {
    render(<DBCPanel {...baseProps} />);
    // The header should contain: 清空, DBC 原文, 加载/重新加载 DBC — in that order.
    const header = screen.getByText('DBC 结构与信号布局').parentElement;
    const headerButtons = within(header).getAllByRole('button');
    const labels = headerButtons.map(b => b.textContent.trim());
    expect(labels).toContain('清空');
    expect(labels).toContain('DBC 原文');
    // 清空 sits BEFORE DBC 原文 (immediately to its left).
    expect(labels.indexOf('清空')).toBeLessThan(labels.indexOf('DBC 原文'));
  });

  it('the header 清空 button is disabled when nothing is selected', () => {
    render(<DBCPanel {...baseProps} />);
    const btn = screen.getByRole('button', { name: /清空/ });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  it('the header 清空 button becomes enabled once at least one signal is selected', () => {
    const selected = [{ key: '256::Sig_00', msgId: 256, signalName: 'Sig_00' }];
    render(<DBCPanel {...baseProps} selectedSignals={selected} />);
    const btn = screen.getByRole('button', { name: /清空/ });
    expect(btn.disabled).toBe(false);
  });

  it('clicking the header 清空 button calls onSignalClearAll', () => {
    const onSignalClearAll = vi.fn();
    const selected = [
      { key: '256::Sig_00', msgId: 256, signalName: 'Sig_00' },
      { key: '256::Sig_01', msgId: 256, signalName: 'Sig_01' }
    ];
    render(
      <DBCPanel {...baseProps} selectedSignals={selected} onSignalClearAll={onSignalClearAll} />
    );
    const btn = screen.getByRole('button', { name: /清空/ });
    fireEvent.click(btn);
    expect(onSignalClearAll).toHaveBeenCalledTimes(1);
  });

  it('search input no longer renders an in-field clear (allowClear is removed)', () => {
    const { container } = render(<DBCPanel {...baseProps} />);
    // antd's allowClear puts a span.ant-input-clear-icon inside .ant-input-affix-wrapper.
    // Once the clear action moves to the header button, this class must be gone so
    // the old X icon can no longer be hidden behind other rows.
    expect(container.querySelector('.ant-input-clear-icon')).toBeNull();
  });

  it('renders no internal search input — search is driven by parent props', () => {
    // The search box now lives in the top toolbar of App.jsx, not inside
    // DBCPanel. The panel should consume search state via props (search /
    // onSearchChange) and render no .ant-input element of its own.
    const { container } = render(<DBCPanel {...baseProps} search="" onSearchChange={() => {}} />);
    // No placeholder text for "检索" should be reachable inside the panel
    // because the input is gone from here. We assert by checking that no
    // input element was rendered.
    const inputs = container.querySelectorAll('.ant-input');
    expect(inputs.length).toBe(0);
  });

  it('filters messages via the external search prop without showing a local input', () => {
    // When the parent passes search="VCU", only the matching message should
    // be visible. The placeholder / input itself must NOT be in the DOM.
    const { container, queryByText } = render(
      <DBCPanel {...baseProps} search="VCU" onSearchChange={() => {}} />
    );
    // Matching message still rendered
    expect(queryByText('VCU_STATE')).toBeTruthy();
    // No antd Input rendered (the field lives in the parent now)
    expect(container.querySelectorAll('.ant-input').length).toBe(0);
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

  it('caps the inline signal detail table to an 8-row scrollable height', () => {
    const { container } = render(<DBCPanel {...baseProps} />);
    const msgHeader = screen.getByText('VCU_STATE');
    fireEvent.click(msgHeader);

    // The detail table scroll container should be capped to ~8 rows via a
    // max-height + overflow-y, so the long table scrolls instead of growing tall.
    const scrollBody = container.querySelector('.ant-table-body');
    expect(scrollBody).toBeTruthy();
    expect(scrollBody.style.maxHeight).toBeTruthy();
    expect(['auto', 'scroll']).toContain(scrollBody.style.overflowY);
  });

  it('renders a popup button that opens a modal with a full signal list and details', () => {
    const onSignalToggle = vi.fn();
    render(<DBCPanel {...baseProps} onSignalToggle={onSignalToggle} />);
    const msgHeader = screen.getByText('VCU_STATE');
    fireEvent.click(msgHeader);

    const openBtn = screen.getByTestId('open-detail-modal');
    expect(openBtn).toBeTruthy();
    fireEvent.click(openBtn);

    // Modal opens with two tabs.
    const detailsTab = screen.getByRole('tab', { name: '信号详情' });
    const listTab = screen.getByRole('tab', { name: '信号列表' });
    expect(detailsTab).toBeTruthy();
    expect(listTab).toBeTruthy();

    // Details tab (default) shows all 42 signal names.
    fireEvent.click(detailsTab);
    for (let i = 0; i < 42; i++) {
      const name = `Sig_${i.toString().padStart(2, '0')}`;
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }

    // Switch to list tab: clicking a signal toggles it.
    fireEvent.click(listTab);
    const listContainer = screen.getByTestId('detail-modal-signal-list');
    const firstSignal = within(listContainer).getByText('Sig_00');
    fireEvent.click(firstSignal);
    expect(onSignalToggle).toHaveBeenCalledWith(256, 'Sig_00');
  });
});
