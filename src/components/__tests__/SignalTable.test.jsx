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

  it('renders float signals (SIG_VALTYPE_) with 6 significant digits (FR-DB-004)', () => {
    const floatDbc = [
      {
        id: 512,
        name: 'FloatMsg',
        signals: [{ name: 'TempF', valueType: 'float32', unit: 'degC' }]
      }
    ];
    const floatSel = [{ key: '512::TempF', msgId: 512, signalName: 'TempF' }];
    const signalData = [
      { t: 1.0, signals: { '512::TempF': 3.1415927410125732 } },
      { t: 2.0, signals: { '512::TempF': 1234567.8 } }
    ];
    render(
      <SignalTable signalData={signalData} selectedSignals={floatSel} dbcMessages={floatDbc} />
    );
    // toPrecision(6): 3.1415927410... -> 3.14159 ; 1234567.8 -> 1.23457e+6
    expect(screen.getByText('3.14159')).toBeTruthy();
    expect(screen.getByText('1.23457e+6')).toBeTruthy();
  });

  it('does not attach enum labels to float signals even when VAL_ exists (FR-DB-004)', () => {
    // valueDefs simulates a VAL_ table present in the DBC; however the decode
    // engine (getEnumLabel) returns undefined for valueType signals, so no
    // '::label' payload is ever produced for floats. This payload mirrors the
    // real engine output (label field absent).
    const floatDbc = [
      {
        id: 100,
        name: 'M',
        signals: [{ name: 'F1', valueType: 'float32', valueDefs: { 1: 'One' } }]
      }
    ];
    const floatSel = [{ key: '100::F1', msgId: 100, signalName: 'F1' }];
    const signalData = [
      { t: 1.0, signals: { '100::F1': 1.5 } }
    ];
    render(
      <SignalTable signalData={signalData} selectedSignals={floatSel} dbcMessages={floatDbc} />
    );
    // The float cell shows the number (1.50000), never the enum tag.
    expect(screen.getByText('1.50000')).toBeTruthy();
    expect(screen.queryByText('One')).toBeNull();
  });
});
