import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineOverview from '../TimelineOverview';

// jsdom has no layout: give the track a deterministic 1000px width so the
// pointer-to-fraction maths is testable.
function mockRect(width = 1000, height = 54) {
  return {
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON() { return {}; }
  };
}

const timeline = {
  bucketCount: 10,
  total: 100,
  tStart: 0,
  tEnd: 10,
  maxCount: 12,
  buckets: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  topIds: [0x100, 0x200],
  perId: [
    { id: 0x100, counts: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6] },
    { id: 0x200, counts: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }
  ]
};

describe('R11 TimelineOverview (minimap)', () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = vi.fn(() => mockRect());
    global.requestAnimationFrame = (cb) => { cb(); return 0; };
    global.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing without bucket data', () => {
    const { container } = render(<TimelineOverview timeline={null} onWindowChange={() => {}} />);
    expect(container.querySelector('[data-testid="timeline-overview"]')).toBeNull();
  });

  it('shows the full span when no window is set', () => {
    render(<TimelineOverview timeline={timeline} window={null} onWindowChange={() => {}} />);
    const brush = screen.getByTestId('timeline-overview-brush');
    expect(brush.style.left).toBe('0%');
    expect(brush.style.width).toBe('100%');
    expect(screen.getByTestId('timeline-overview-window').textContent).toContain('0.000s');
    expect(screen.getByTestId('timeline-overview-window').textContent).toContain('10.000s');
  });

  it('positions the brush from the shared window', () => {
    render(
      <TimelineOverview
        timeline={timeline}
        window={{ start: 2, end: 5 }}
        onWindowChange={() => {}}
      />
    );
    const brush = screen.getByTestId('timeline-overview-brush');
    expect(brush.style.left).toBe('20%');
    expect(brush.style.width).toBe('30%');
  });

  it('zooms in on wheel down/up around the cursor', () => {
    const onWindowChange = vi.fn();
    render(<TimelineOverview timeline={timeline} window={null} onWindowChange={onWindowChange} />);
    fireEvent.wheel(screen.getByTestId('timeline-overview-track'), { deltaY: -100, clientX: 500 });
    expect(onWindowChange).toHaveBeenCalledTimes(1);
    const next = onWindowChange.mock.calls[0][0];
    expect(next.end - next.start).toBeCloseTo(8, 3);
    expect(next.start).toBeCloseTo(1, 3);
  });

  it('halves the window on double click', () => {
    const onWindowChange = vi.fn();
    render(<TimelineOverview timeline={timeline} window={null} onWindowChange={onWindowChange} />);
    fireEvent.doubleClick(screen.getByTestId('timeline-overview-track'), { clientX: 500 });
    const next = onWindowChange.mock.calls[0][0];
    expect(next.end - next.start).toBeCloseTo(5, 3);
  });

  it('pans a zoomed window by dragging', () => {
    const onWindowChange = vi.fn();
    render(
      <TimelineOverview
        timeline={timeline}
        window={{ start: 2, end: 6 }}
        onWindowChange={onWindowChange}
      />
    );
    const track = screen.getByTestId('timeline-overview-track');
    fireEvent.mouseDown(track, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 600 });
    fireEvent.mouseUp(document);
    expect(onWindowChange).toHaveBeenCalled();
    const next = onWindowChange.mock.calls.at(-1)[0];
    expect(next.start).toBeCloseTo(3, 3);
    expect(next.end).toBeCloseTo(7, 3);
  });

  it('resets to the full span', () => {
    const onWindowChange = vi.fn();
    render(
      <TimelineOverview
        timeline={timeline}
        window={{ start: 2, end: 6 }}
        onWindowChange={onWindowChange}
      />
    );
    fireEvent.click(screen.getByTestId('timeline-overview-reset'));
    expect(onWindowChange).toHaveBeenCalledWith(null);
  });

  it('renders per-ID heat bars with id/name labels in the footer', () => {
    render(
      <TimelineOverview
        timeline={timeline}
        window={null}
        onWindowChange={() => {}}
        dbcMessages={[{ id: 0x100, name: 'VCU_Status' }]}
      />
    );
    expect(screen.getByTestId('timeline-overview').textContent).toContain('VCU_Status');
    expect(screen.getByTestId('timeline-overview').textContent).toContain('100 帧');
  });
});
