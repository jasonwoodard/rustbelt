import { describe, it, expect } from 'vitest';
import { computeTimeline, slackMin } from '../src/schedule';
import type { ScheduleCtx } from '../src/schedule';
import { hhmmToMin } from '../src/time';

function buildCtx(): ScheduleCtx {
  return {
    start: { id: 'S', name: 'start', coord: [0, 0] },
    end: { id: 'E', name: 'end', coord: [10, 0] },
    window: { start: '00:00', end: '23:59' },
    mph: 60,
    defaultDwellMin: 0,
    stores: {
      A: { id: 'A', name: 'A', coord: [5, 0] },
    },
  };
}

describe('schedule utilities', () => {
  it('computeTimeline yields monotonic stop times', () => {
    const ctx = buildCtx();
    const timeline = computeTimeline(['A'], ctx);
    let last = 0;
    for (const stop of timeline.stops) {
      const arrive = hhmmToMin(stop.arrive);
      const depart = hhmmToMin(stop.depart);
      expect(arrive).toBeGreaterThanOrEqual(last);
      expect(depart).toBeGreaterThanOrEqual(arrive);
      last = depart;
    }
  });

  it('slackMin is never negative', () => {
    const ctx = buildCtx();
    // Tighten the window so arrival exceeds the end time
    const tightCtx: ScheduleCtx = {
      ...ctx,
      window: { start: '00:00', end: '00:05' },
    };
    const slack = slackMin(['A'], tightCtx);
    expect(slack).toBe(0);
  });
});
