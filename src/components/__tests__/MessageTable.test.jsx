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
