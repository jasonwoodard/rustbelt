import { describe, it, expect } from 'vitest';
import { computeTimeline, onTimeRisk, slackMin } from '../src/schedule';
import type { ScheduleCtx, TimelineResult } from '../src/schedule';
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

  it('propagates store address to stop plan', () => {
    const ctx = buildCtx();
    ctx.stores.A.address = '1 Main St';
    const timeline = computeTimeline(['A'], ctx);
    const stop = timeline.stops.find((s) => s.id === 'A');
    expect(stop?.address).toBe('1 Main St');
  });

  it('scales total drive time with robustnessFactor', () => {
    const order = ['A'];
    const baseline = computeTimeline(order, buildCtx());
    const robustCtx: ScheduleCtx = { ...buildCtx(), robustnessFactor: 1.5 };
    const robust = computeTimeline(order, robustCtx);

    expect(baseline.totalDriveMin).toBeGreaterThan(0);
    expect(robust.totalDriveMin).toBeGreaterThan(baseline.totalDriveMin);
    expect(robust.totalDriveMin).toBeCloseTo(
      baseline.totalDriveMin * 1.5,
      5,
    );
  });

  it('raises on-time risk when the threshold increases', () => {
    const timeline: TimelineResult = {
      stops: [
        {
          id: 'S',
          name: 'start',
          type: 'start',
          arrive: '08:00',
          depart: '08:00',
          lat: 0,
          lon: 0,
        },
        {
          id: 'A',
          name: 'Store A',
          type: 'store',
          arrive: '10:30',
          depart: '10:45',
          lat: 1,
          lon: 1,
        },
        {
          id: 'E',
          name: 'end',
          type: 'end',
          arrive: '11:00',
          depart: '11:00',
          lat: 2,
          lon: 2,
        },
      ],
      totalDriveMin: 0,
      totalDwellMin: 0,
      hotelETAmin: hhmmToMin('11:00'),
    };

    const lowThresholdRisk = onTimeRisk(timeline, '11:00', 15);
    const highThresholdRisk = onTimeRisk(timeline, '11:00', 45);

    expect(lowThresholdRisk).toBeCloseTo(0.5);
    expect(highThresholdRisk).toBe(1);
    expect(highThresholdRisk).toBeGreaterThan(lowThresholdRisk);
  });
});
