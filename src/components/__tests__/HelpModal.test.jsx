import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HelpModal from '../HelpModal';

describe('HelpModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<HelpModal open={false} onClose={() => {}} />);
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('shows all manual sections when open', () => {
    render(<HelpModal open onClose={() => {}} />);
    const headings = ['软件简介', '快速上手', '界面总览', 'DBC 结构与信号布局面板', '信号解析页签', 'CAN 报文日志页签', '物理量 CSV 页签', '支持格式与约定', '常见问题'];
    for (const h of headings) {
      const els = screen.queryAllByText(new RegExp(h));
      expect(els.length, `missing section: ${h}`).toBeGreaterThan(0);
    }
  });

  it('contains key operational keywords', () => {
    render(<HelpModal open onClose={() => {}} />);
    const body = document.body.textContent || '';
    expect(body).toContain('加载 ASC');
    expect(body).toContain('加载 BLF');
    expect(body).toContain('加载 DBC');
    expect(body).toContain('DBC 原文');
    expect(body).toContain('CRC');
    expect(body).toContain('使用手册');
  });

  it('fires onClose when ok button clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /我知道了/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
