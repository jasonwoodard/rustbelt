import { describe, it, expect } from 'vitest';
import { planDay, type HeuristicCtx } from '../src/heuristics';
import { computeTimeline, isFeasible, type ScheduleCtx } from '../src/schedule';
import { BREAK_ID, type DayConfig, type Store } from '../src/types';
import { hhmmToMin } from '../src/time';

const sharedCoord = [40.0, -86.0] as const;

function createStore(id: string, dwellMin: number): Store {
  return {
    id,
    name: `Store ${id}`,
    coord: sharedCoord,
    dwellMin,
  };
}

function createDay(overrides?: Partial<DayConfig>): DayConfig {
  return {
    dayId: 'D1',
    start: { id: 'START', name: 'Start', coord: sharedCoord },
    end: { id: 'END', name: 'End', coord: sharedCoord },
    window: { start: '08:00', end: '18:00' },
    mph: 30,
    defaultDwellMin: 0,
    breakWindow: { start: '12:00', end: '12:30' },
    ...overrides,
  };
}

function createScheduleCtx(day: DayConfig, stores: Store[]): ScheduleCtx {
  const storeMap: Record<string, Store> = {};
  for (const store of stores) {
    storeMap[store.id] = store;
  }
  const ctx: ScheduleCtx = {
    start: day.start,
    end: day.end,
    window: day.window,
    mph: day.mph ?? 30,
    defaultDwellMin: day.defaultDwellMin ?? 0,
    stores: storeMap,
    mustVisitIds: day.mustVisitIds,
    locks: day.locks,
    maxDriveTime: day.maxDriveTime,
    maxStops: day.maxStops,
    breakWindow: day.breakWindow,
    robustnessFactor: day.robustnessFactor,
    dayOfWeek: day.dayOfWeek,
  };
  return ctx;
}

function createHeuristicCtx(day: DayConfig, stores: Store[]): HeuristicCtx {
  const scheduleCtx = createScheduleCtx(day, stores);
  if (day.breakWindow) {
    scheduleCtx.stores[BREAK_ID] = {
      id: BREAK_ID,
      name: 'Break placeholder',
      coord: day.start.coord,
    };
  }
  const candidateIds = stores.map((store) => store.id);
  const mustVisitIds = [...(day.mustVisitIds ?? [])];
  if (day.breakWindow && !mustVisitIds.includes(BREAK_ID)) {
    mustVisitIds.push(BREAK_ID);
  }
  const ctx: HeuristicCtx = {
    ...scheduleCtx,
    candidateIds,
  };
  if (mustVisitIds.length > 0) {
    ctx.mustVisitIds = mustVisitIds;
  }
  return ctx;
}

describe('break windows', () => {
  it('inserts a break when a breakWindow is configured', () => {
    const day = createDay({ mustVisitIds: ['A'] });
    const store = createStore('A', 30);
    const ctx = createHeuristicCtx(day, [store]);
    const order = planDay(ctx);
    expect(order).toContain(BREAK_ID);
    const timeline = computeTimeline(order, ctx);
    expect(timeline.break).toEqual({
      arriveMin: hhmmToMin('12:00'),
      departMin: hhmmToMin('12:30'),
    });
  });

  it('is infeasible if the break is omitted', () => {
    const day = createDay({ mustVisitIds: ['A'] });
    const store = createStore('A', 30);
    const scheduleCtx = createScheduleCtx(day, [store]);
    expect(isFeasible(['A'], scheduleCtx)).toBe(false);
  });

  it('is infeasible if the break falls outside of the window', () => {
    const day = createDay({ mustVisitIds: ['A'] });
    const store = createStore('A', 300);
    const scheduleCtx = createScheduleCtx(day, [store]);
    const order = ['A', BREAK_ID];
    expect(isFeasible(order, scheduleCtx)).toBe(false);
  });
});
