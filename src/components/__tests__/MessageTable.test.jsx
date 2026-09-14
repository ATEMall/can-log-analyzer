import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageTable from '../MessageTable';

// R3 (FR-DB-002 / UI-2.1-05): extended-frame ID display + format-mismatch marking.
describe('MessageTable R3 extended-frame UI', () => {
  const dbcMessages = [
    { id: 2048, name: 'ExtMsg', isExtended: true, signals: [] }, // VFrameFormat=1
    { id: 128, name: 'StdMsg', isExtended: false, signals: [] }
  ];

  const frames = [
    { id: 2048, timestamp: 0.001, channel: 1, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], isExtended: true },
    { id: 128, timestamp: 0.002, channel: 1, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], isExtended: false }
  ];

  it('shows the blue Ext badge on extended frames', () => {
    render(<MessageTable messages={frames} dbcMessages={dbcMessages} />);
    const extTags = screen.getAllByText('Ext');
    expect(extTags.length).toBe(1);
    expect(extTags[0].className).toMatch(/ant-tag-blue/);
  });

  it('renders the extended id with full 29-bit width', () => {
    render(<MessageTable messages={frames} dbcMessages={dbcMessages} />);
    // 0x2048 -> padded 0x00000800? 2048 = 0x800 -> padded to 3 digits 0x800
    expect(screen.getByText('0x800')).toBeTruthy();
  });

  it('marks a frame 未匹配 (grey) when the log flag mismatches the DBC model', () => {
    const stdFrames = [
      // DBC says extended (VFrameFormat=1) but the log frame is standard -> mismatch
      { id: 2048, timestamp: 0.001, channel: 1, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], isExtended: false }
    ];
    render(<MessageTable messages={stdFrames} dbcMessages={dbcMessages} />);
    const mm = screen.getByText('未匹配');
    expect(mm).toBeTruthy();
    expect(mm.className).toMatch(/ant-tag/);
  });

  it('marks a frame 未匹配 when the DBC is standard but the frame is extended', () => {
    const extFrames = [
      { id: 128, timestamp: 0.001, channel: 1, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], isExtended: true }
    ];
    render(<MessageTable messages={extFrames} dbcMessages={dbcMessages} />);
    expect(screen.getByText('未匹配')).toBeTruthy();
  });

  it('does not mark 未匹配 when there is no DBC definition for the id', () => {
    const unknown = [
      { id: 0x999, timestamp: 0.001, channel: 1, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], isExtended: true }
    ];
    render(<MessageTable messages={unknown} dbcMessages={dbcMessages} />);
    expect(screen.queryByText('未匹配')).toBeNull();
  });

  it('matches normal standard frames without any mismatch badge', () => {
    render(<MessageTable messages={frames} dbcMessages={dbcMessages} />);
    expect(screen.queryByText('未匹配')).toBeNull();
  });
});

// R11 (UI-002): global-search hit highlighting + locate-to-frame paging.
describe('MessageTable R11 search highlight + locate', () => {
  const frames = Array.from({ length: 250 }, (_, i) => ({
    id: i % 50 === 0 ? 0x123 : 0x456,
    timestamp: i * 0.001,
    channel: 1,
    direction: 'Rx',
    dlc: 8,
    data: [0, 0, 0, 0, 0, 0, 0, 0]
  }));

  it('marks rows whose ID is a search hit', () => {
    const { container } = render(
      <MessageTable messages={frames} highlightIds={[0x123]} />
    );
    // antd virtual mode renders each row as a div; jsdom only materialises the
    // visible slice, so assert at least one hit row carries the highlight class.
    expect(container.querySelectorAll('.search-hit-row').length).toBeGreaterThan(0);
    expect(screen.getByTestId('message-table-hit-ids').textContent).toContain('1');
  });

  it('does not highlight anything without hits', () => {
    const { container } = render(<MessageTable messages={frames} />);
    expect(container.querySelectorAll('.search-hit-row').length).toBe(0);
    expect(screen.queryByTestId('message-table-hit-ids')).toBeNull();
  });

  it('jumps to the page containing the located frame', async () => {
    render(<MessageTable messages={frames} locateIndex={150} locateNonce={1} />);
    // Frame #150 lives on the second 100-row page.
    expect(await screen.findByText('101-200 / 250')).toBeTruthy();
  });

  it('applies the shared time window to the rows', () => {
    render(<MessageTable messages={frames} timeWindow={{ start: 0.05, end: 0.099 }} />);
    // 0.050s..0.099s -> 50 frames.
    expect(screen.getByText('50 / 250')).toBeTruthy();
  });
});
