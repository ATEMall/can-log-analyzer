import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  LineChart as RawLineChart, Line as RawLine, XAxis as RawXAxis, YAxis as RawYAxis
} from 'recharts';
import SignalChart from '../SignalChart';

// jsdom has no layout engine; fix the container size so recharts can render.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  const FixedResponsiveContainer = ({ children }) =>
    React.cloneElement(children, { width: 800, height: 400 });
  return { ...actual, ResponsiveContainer: FixedResponsiveContainer };
});

const dbcMessages = [
  {
    id: 256,
    name: 'EngineInfo',
    signals: [
      { name: 'EngineSpeed', unit: 'rpm' },
      { name: 'CoolantTemp', unit: 'degC' }
    ]
  },
  {
    id: 512,
    name: 'ChassisInfo',
    signals: [{ name: 'SteeringAngle', unit: 'deg' }]
  }
];

const selectedSignals = [
  { key: '256::EngineSpeed', msgId: 256, signalName: 'EngineSpeed' },
  { key: '256::CoolantTemp', msgId: 256, signalName: 'CoolantTemp' },
  { key: '512::SteeringAngle', msgId: 512, signalName: 'SteeringAngle' }
];

function makeSignalData(count, overrides) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const signals = {
      '256::EngineSpeed': 1000 + i * 10,
      '256::CoolantTemp': 80 + (i % 5),
      '512::SteeringAngle': i % 2 === 0 ? 10 : -10
    };
    if (overrides && overrides.signals) Object.assign(signals, overrides.signals(i));
    rows.push({ t: 0.1 + i * 0.01, signals });
  }
  return rows;
}

function curveCount() {
  return document.querySelectorAll('.recharts-line').length;
}

describe('SignalChart', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one curve per selected signal', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);
    const curves = document.querySelectorAll('path.recharts-line-curve');
    expect(curves.length).toBe(3);
    for (const p of curves) {
      expect(p.getAttribute('d')).toBeTruthy();
    }
  });

  it('renders constant-value signals (flat line stays visible)', () => {
    // all values of every signal are identical -> Y domain must not collapse
    const flat = makeSignalData(20, {
      signals: () => ({
        '256::EngineSpeed': 50,
        '256::CoolantTemp': 2,
        '512::SteeringAngle': 0
      })
    });
    render(
      <SignalChart signalData={flat} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);
    const curves = document.querySelectorAll('path.recharts-line-curve');
    expect(curves.length).toBe(3);
    for (const p of curves) {
      expect(p.getAttribute('d')).toBeTruthy();
    }
  });

  it('renders enum signals from numeric value + separate label', () => {
    // decode layer now stores numeric value at key and label at key + '::label'
    const data = makeSignalData(10, {
      signals: (i) => ({
        '512::SteeringAngle': i % 2 === 0 ? 0 : 100,
        '512::SteeringAngle::label': i % 2 === 0 ? 'Idle' : 'Full'
      })
    });
    render(
      <SignalChart signalData={data} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);
  });

  it('renders empty state when no signal data', () => {
    render(<SignalChart signalData={[]} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />);
    expect(curveCount()).toBe(0);
    expect(screen.getByText(/解码后可查看曲线/i)).toBeTruthy();
  });

  it('recovers after data becomes empty then non-empty (hooks order stability)', () => {
    const { rerender } = render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);

    // data cleared (e.g. after loading a new file)
    rerender(<SignalChart signalData={null} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />);
    expect(curveCount()).toBe(0);

    // decode again -> should render without "Rendered more hooks" crash
    rerender(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);
  });

  it('filters curves via the filter bar tags', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);

    const bar = screen.getByTestId('chart-filter-bar');
    fireEvent.click(withinText(bar, 'EngineSpeed'));
    expect(curveCount()).toBe(2);

    fireEvent.click(withinText(bar, 'EngineSpeed'));
    expect(curveCount()).toBe(3);

    // hide two, then clear all via "清空"
    fireEvent.click(withinText(bar, 'CoolantTemp'));
    fireEvent.click(withinText(bar, 'EngineSpeed'));
    fireEvent.click(withinText(bar, '清空'));
    expect(curveCount()).toBe(0);
  });

  it('supports select-all / clear-all in the filter bar', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    const bar = screen.getByTestId('chart-filter-bar');
    fireEvent.click(withinText(bar, '清空'));
    expect(curveCount()).toBe(0);
    fireEvent.click(withinText(bar, '全部'));
    expect(curveCount()).toBe(3);
  });

  it('connects sparse signal points into a continuous curve (connectNulls)', () => {
    // Real decode data: each frame row only carries that frame's message signals,
    // so other signals are missing (null) on many rows. SteeringAngle is present
    // only on even rows -> without connectNulls its curve breaks into isolated
    // dots/segments. The rendered path must be ONE continuous curve (single M).
    const sparse = makeSignalData(20, {
      signals: (i) => {
        const s = {
          '256::EngineSpeed': 1000 + i * 10,
          '256::CoolantTemp': 80 + (i % 5)
        };
        if (i % 2 === 0) s['512::SteeringAngle'] = i % 4 === 0 ? 10 : -10;
        return s;
      }
    });
    render(
      <SignalChart signalData={sparse} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(curveCount()).toBe(3);

    const curves = document.querySelectorAll('path.recharts-line-curve');
    expect(curves.length).toBe(3);

    // The sparse line (3rd: 512::SteeringAngle) must be a single continuous path.
    const steering = curves[2];
    const d = steering.getAttribute('d');
    const moveCount = (d.match(/M/g) || []).length;
    expect(moveCount).toBe(1);
    expect(d.length).toBeGreaterThan(20);

    // dot=false means only lines are drawn, no point markers
    expect(document.querySelectorAll('.recharts-line-dot').length).toBe(0);
  });

  it('regression guard: without connectNulls the same sparse data breaks into many segments', () => {
    // Prove the assertion above has distinguishing power: with the old
    // connectNulls=false the sparse curve renders as multiple M segments.
    const sparseData = [];
    for (let i = 0; i < 20; i++) {
      const point = { t: 0.1 + i * 0.01 };
      if (i % 2 === 0) point.steer = i % 4 === 0 ? 10 : -10;
      sparseData.push(point);
    }
    render(
      <RawLineChart data={sparseData} width={800} height={400}>
        <RawXAxis dataKey="t" />
        <RawYAxis />
        <RawLine type="monotone" dataKey="steer" dot={false} connectNulls={false} isAnimationActive={false} />
      </RawLineChart>
    );
    const paths = document.querySelectorAll('path.recharts-line-curve');
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const d = paths[0].getAttribute('d');
    const moveCount = (d.match(/M/g) || []).length;
    expect(moveCount).toBeGreaterThan(1);
  });

  it('keeps legend and curves in fixed B0..B7 order regardless of selection order', () => {
    // Window width changes must never shuffle the legend. The chart always
    // renders signals in a deterministic order: message ID first, then
    // numeric-aware signal name (B0, B1, ..., B7), no matter how the signals
    // were selected/added.
    const shuffled = [
      { key: '512::B7', msgId: 512, signalName: 'B7' },
      { key: '512::B2', msgId: 512, signalName: 'B2' },
      { key: '512::B0', msgId: 512, signalName: 'B0' },
      { key: '512::B5', msgId: 512, signalName: 'B5' },
      { key: '512::B1', msgId: 512, signalName: 'B1' },
      { key: '512::B3', msgId: 512, signalName: 'B3' },
      { key: '512::B6', msgId: 512, signalName: 'B6' },
      { key: '512::B4', msgId: 512, signalName: 'B4' }
    ];
    const data = [];
    for (let i = 0; i < 10; i++) {
      const signals = {};
      for (const s of shuffled) signals[s.key] = i;
      data.push({ t: 0.1 + i * 0.01, signals });
    }
    render(
      <SignalChart signalData={data} selectedSignals={shuffled} dbcMessages={[]} />
    );

    // In-chart legend (filter bar tags) must be in fixed B0..B7 order.
    const bar = screen.getByTestId('chart-filter-bar');
    const tagTexts = Array.from(bar.querySelectorAll('.ant-tag')).map(el => el.textContent.trim());
    expect(tagTexts).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);

    // One curve per signal, rendered in the same sorted order.
    expect(curveCount()).toBe(8);
    const curves = document.querySelectorAll('path.recharts-line-curve');
    expect(curves.length).toBe(8);

    // Colors are assigned from the fixed sorted order: B0 always gets the
    // first palette color and B7 the eighth, regardless of selection order.
    expect(curves[0].getAttribute('stroke')).toBe('#1890ff');
    expect(curves[7].getAttribute('stroke')).toBe('#2f54eb');
  });

  // ---- R13: multi Y-axis ----

  it('auto-groups signals by unit onto left/right Y axes', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );

    // Three distinct units -> a left axis plus a right axis.
    expect(document.querySelectorAll('.recharts-yAxis').length).toBe(2);

    // Same unit shares one axis: the largest group (tie -> first in the
    // deterministic order, here degC) takes the left axis, the rest go right.
    const bar = screen.getByTestId('chart-axis-bar');
    expect(withinText(bar, 'CoolantTemp · 左')).toBeTruthy();
    expect(withinText(bar, 'EngineSpeed · 右')).toBeTruthy();
    expect(withinText(bar, 'SteeringAngle · 右')).toBeTruthy();
  });

  it('tints each Y axis with the colour of its first signal curve', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    const strokes = Array.from(
      document.querySelectorAll('.recharts-yAxis line.recharts-cartesian-axis-line')
    ).map(l => l.getAttribute('stroke'));
    // left axis -> first sorted signal (CoolantTemp, palette #0)
    // right axis -> first right-axis signal (EngineSpeed, palette #1)
    expect(strokes).toContain('#1890ff');
    expect(strokes).toContain('#52c41a');
  });

  it('uses a single Y axis when every signal shares one unit', () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={[]} />
    );
    expect(document.querySelectorAll('.recharts-yAxis').length).toBe(1);
    const bar = screen.getByTestId('chart-axis-bar');
    expect(withinText(bar, 'EngineSpeed · 左')).toBeTruthy();
    expect(withinText(bar, 'CoolantTemp · 左')).toBeTruthy();
    expect(withinText(bar, 'SteeringAngle · 左')).toBeTruthy();
  });

  it('lets the user move a signal between the left and right axis', async () => {
    render(
      <SignalChart signalData={makeSignalData(20)} selectedSignals={selectedSignals} dbcMessages={dbcMessages} />
    );
    expect(document.querySelectorAll('.recharts-yAxis').length).toBe(2);

    const bar = screen.getByTestId('chart-axis-bar');

    // Move SteeringAngle (auto: right) to the left axis.
    await chooseAxis('512::SteeringAngle', '左轴');
    expect(withinText(bar, 'SteeringAngle · 左')).toBeTruthy();
    // EngineSpeed is still on the right, so the right axis remains.
    expect(document.querySelectorAll('.recharts-yAxis').length).toBe(2);

    // Move EngineSpeed to the left too -> right axis disappears.
    await chooseAxis('256::EngineSpeed', '左轴');
    expect(withinText(bar, 'EngineSpeed · 左')).toBeTruthy();
    expect(document.querySelectorAll('.recharts-yAxis').length).toBe(1);
  });

  // ---- R13 rework: min/max bucket decimation ----

  it('decimates within the render budget and shows the fidelity notice', () => {
    const rows = [];
    for (let i = 0; i < 600; i++) {
      rows.push({
        t: i * 0.01,
        signals: {
          '256::EngineSpeed': 100 + Math.sin(i / 9) * 5,
          '256::CoolantTemp': 80 + Math.sin(i / 7),
          '512::SteeringAngle': i % 5
        }
      });
    }
    const { container } = render(
      <SignalChart
        signalData={rows}
        selectedSignals={selectedSignals}
        dbcMessages={dbcMessages}
        maxRenderPoints={40}
      />
    );

    expect(screen.getByText(/min\/max 分桶保真降采样/)).toBeTruthy();

    // 40-point budget over 600 rows with 3 signals => far coarser than input.
    const curve = container.querySelector('path.recharts-line-curve');
    const segments = (curve.getAttribute('d').match(/[LC]/g) || []).length;
    expect(segments).toBeGreaterThan(0);
    expect(segments).toBeLessThan(60);
  });

  it('keeps a spike end-to-end (its axis still reaches the peak value)', () => {
    const rows = [];
    const SPIKE_AT = 337; // arbitrary: equal-step sampling would skip it
    for (let i = 0; i < 600; i++) {
      rows.push({
        t: i * 0.01,
        signals: {
          '256::EngineSpeed': i === SPIKE_AT ? 5000 : 100,
          '256::CoolantTemp': 80,
          '512::SteeringAngle': 0
        }
      });
    }
    const { container } = render(
      <SignalChart
        signalData={rows}
        selectedSignals={selectedSignals}
        dbcMessages={dbcMessages}
        maxRenderPoints={40}
      />
    );

    // Decimation must keep the 5000 spike, so some Y axis still scales to it.
    // (Axis order is auto-grouped by unit, so scan every Y-axis tick. recharts
    // v3 hoists tick labels into a chart-root z-index layer, so they are NOT
    // descendants of .recharts-yAxis — select via the per-axis label group.)
    const ticks = Array.from(
      container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
    )
      .map(el => Number(el.textContent))
      .filter(Number.isFinite);
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBeGreaterThan(1000);
  });
});

// antd renders the dropdown menu overlay more than once in jsdom, so query the
// menu item elements directly instead of relying on a unique text match.
async function chooseAxis(signalKey, label) {
  fireEvent.click(screen.getByTestId(`axis-btn-${signalKey}`));
  await screen.findAllByText(label);
  const items = Array.from(document.querySelectorAll('.ant-dropdown-menu-item'))
    .filter(el => el.textContent.trim() === label);
  expect(items.length).toBeGreaterThan(0);
  fireEvent.click(items[items.length - 1]);
}

function withinText(container, text) {
  // only match interactive elements: filter tags and buttons
  const els = container.querySelectorAll('.ant-tag, .ant-btn');
  for (const el of els) {
    if (el.textContent && el.textContent.trim() === text) return el;
  }
  throw new Error(`element with text "${text}" not found`);
}
