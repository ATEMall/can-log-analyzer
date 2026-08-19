import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignalTable from '../SignalTable';

const dbcMessages = [
  {
    id: 256,
    name: 'EngineInfo',
    signals: [{ name: 'EngineSpeed', unit: 'rpm' }]
  }
];

const selectedSignals = [
  { key: '256::EngineSpeed', msgId: 256, signalName: 'EngineSpeed' }
];

describe('SignalTable', () => {
  it('renders enum label tags from the ::label payload', () => {
    const signalData = [
      {
        t: 1.0,
        signals: {
          '256::EngineSpeed': 100,
          '256::EngineSpeed::label': 'Full_Throttle'
        }
      }
    ];
    render(
      <SignalTable signalData={signalData} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(screen.getByText('Full_Throttle')).toBeTruthy();
    // the numeric raw value must NOT be shown for the enum cell
    expect(screen.queryByText('100.0')).toBeNull();
  });

  it('renders numeric values with unit-aware decimals', () => {
    const signalData = [
      {
        t: 1.0,
        signals: { '256::EngineSpeed': 1234.5 }
      }
    ];
    render(
      <SignalTable signalData={signalData} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(screen.getByText('1234.5')).toBeTruthy();
  });

  it('renders empty state when no data', () => {
    render(<SignalTable signalData={[]} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />);
    expect(screen.getByText(/暂无解码数据/i)).toBeTruthy();
  });
});
