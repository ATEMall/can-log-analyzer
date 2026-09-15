import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatsPanel from '../StatsPanel';

function makeStats(overrides = {}) {
  return {
    totalFrames: 1000,
    load: {
      bitrate: 500000,
      tStart: 0,
      tEnd: 10,
      interval: 1,
      duration: 10,
      totalFrames: 1000,
      avg: 12.34,
      peak: 45.6,
      peakTime: 3,
      points: Array.from({ length: 10 }, (_, i) => ({ t: i, load: i * 5, frames: 100 }))
    },
    cycles: {
      tolerancePct: 10,
      totalIds: 2,
      rows: [
        {
          id: 0x100, name: 'MsgA', count: 500, firstIndex: 3,
          expected: 10, avgPeriod: 10.2, minPeriod: 9.8, maxPeriod: 12,
          maxJitter: 2.0, avgJitter: 0.4, overCount: 5, overRatio: 0.01
        },
        {
          id: 0x200, name: 'MsgB', count: 400, firstIndex: 1,
          expected: 20, avgPeriod: 20, minPeriod: 20, maxPeriod: 20,
          maxJitter: 0, avgJitter: 0, overCount: 0, overRatio: 0
        }
      ]
    },
    errors: {
      total: 3,
      busOffCount: 1,
      byKind: [{ kind: 'stuff', count: 2 }, { kind: 'form', count: 1 }],
      events: [
        { timestamp: 1.5, channel: 1, kind: 'error-frame', category: 'stuff' },
        { timestamp: 4.25, channel: 1, kind: 'error-frame', category: 'form' }
      ],
      states: [
        { timestamp: 2.0, kind: 'bus-state', state: 'error-active', channel: 1 },
        { timestamp: 6.0, kind: 'bus-state', state: 'bus-off', channel: 1 }
      ]
    },
    ...overrides
  };
}

describe('R12 StatsPanel', () => {
  it('shows the empty state before any statistics exist', () => {
    render(<StatsPanel stats={null} />);
    expect(screen.getByTestId('stats-panel')).toBeTruthy();
    expect(screen.getByTestId('stats-panel').textContent).toContain('加载 ASC/BLF 日志后自动统计');
  });

  it('renders the average / peak bus load and the error counters', () => {
    render(<StatsPanel stats={makeStats()} />);
    expect(screen.getByTestId('stats-load-avg').textContent).toBe('12.3%');
    expect(screen.getByTestId('stats-load-peak').textContent).toBe('45.6%');
    expect(screen.getByTestId('stats-panel-error-total').textContent).toBe('3');
    expect(screen.getByTestId('stats-panel-busoff-count').textContent).toBe('1');
    // Category counters are surfaced as tags.
    expect(screen.getByTestId('stats-panel').textContent).toContain('位填充错误: 2');
    expect(screen.getByTestId('stats-panel').textContent).toContain('格式错误: 1');
  });

  it('renders the per-second load chart', () => {
    render(<StatsPanel stats={makeStats()} />);
    const chart = screen.getByTestId('stats-panel-load-chart');
    expect(chart).toBeTruthy();
    expect(chart.querySelector('canvas')).toBeTruthy();
  });

  it('jumps to the log table when an error event is clicked', () => {
    const onJumpToTime = vi.fn();
    render(<StatsPanel stats={makeStats()} onJumpToTime={onJumpToTime} />);
    fireEvent.click(screen.getByTestId('stats-panel-error-event-1'));
    expect(onJumpToTime).toHaveBeenCalledWith(4.25);
  });

  it('filters/locates the message table when a cycle row is clicked', () => {
    const onFilterId = vi.fn();
    render(<StatsPanel stats={makeStats()} onFilterId={onFilterId} />);
    fireEvent.click(screen.getByTestId('stats-cycle-row-256'));
    expect(onFilterId).toHaveBeenCalledWith(0x100, 3);
  });

  it('keeps only out-of-tolerance rows when the switch is on', () => {
    render(<StatsPanel stats={makeStats()} />);
    expect(screen.getByTestId('stats-cycle-row-256')).toBeTruthy();
    expect(screen.getByTestId('stats-cycle-row-512')).toBeTruthy();

    fireEvent.click(screen.getByTestId('stats-over-only'));

    expect(screen.queryByTestId('stats-cycle-row-512')).toBeNull();
    expect(screen.getByTestId('stats-cycle-row-256')).toBeTruthy();
  });

  it('renders the bus-state timeline markers', () => {
    const { container } = render(<StatsPanel stats={makeStats()} />);
    expect(screen.getByTestId('stats-panel-state-timeline')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="stats-panel-state-marker-1"]')).toHaveLength(1);
  });

  it('exports the aggregated statistics through the CSV channel', () => {
    const onExportCSV = vi.fn();
    render(<StatsPanel stats={makeStats()} onExportCSV={onExportCSV} />);
    fireEvent.click(screen.getByTestId('stats-export-csv'));
    expect(onExportCSV).toHaveBeenCalledTimes(1);
  });
});
