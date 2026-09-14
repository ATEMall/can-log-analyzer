import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalSearchBar from '../GlobalSearchBar';

function setup(overrides = {}) {
  const props = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    result: null,
    scope: 'all',
    onScopeChange: vi.fn(),
    inputRef: React.createRef(),
    searching: false,
    ...overrides
  };
  render(<GlobalSearchBar {...props} />);
  return props;
}

describe('R11 GlobalSearchBar', () => {
  it('hides the hit count until a query is typed', () => {
    setup();
    expect(screen.queryByTestId('global-search-count')).toBeNull();
  });

  it('shows the hit count from the search result', () => {
    setup({
      value: '0x123',
      result: { kind: 'id', matchCount: 12, matchedIds: [0x123], firstIndex: 3 }
    });
    expect(screen.getByTestId('global-search-count').textContent).toBe('12 hits');
    expect(screen.getByTestId('global-search-locate-hint')).toBeTruthy();
  });

  it('shows 无匹配 when nothing matched', () => {
    setup({ value: 'zzz', result: { kind: 'none', matchCount: 0, firstIndex: null } });
    expect(screen.getByTestId('global-search-count').textContent).toBe('无匹配');
    expect(screen.queryByTestId('global-search-locate-hint')).toBeNull();
  });

  it('forwards typing and Enter', () => {
    const props = setup({ value: 'a' });
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'abc' } });
    expect(props.onChange).toHaveBeenCalledWith('abc');
    fireEvent.keyDown(screen.getByTestId('global-search-input'), { key: 'Enter' });
    // antd Input fires onPressEnter through keyDown of 'Enter'
    expect(props.onSubmit).toHaveBeenCalled();
  });
});
