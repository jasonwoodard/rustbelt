import { describe, it, expect } from 'vitest';
import { adviseInfeasible } from '../src/infeasibility';
import type { ScheduleCtx } from '../src/schedule';

describe('infeasibility advisor', () => {
  it('suggests dropping stores for overfull sets', () => {
    const ctx: ScheduleCtx = {
      start: { id: 'S', name: 'S', coord: [0, 0] },
      end: { id: 'E', name: 'E', coord: [0, 0] },
      window: { start: '09:00', end: '10:00' },
      mph: 60,
      defaultDwellMin: 0,
      stores: {
        A: { id: 'A', name: 'A', coord: [0, 0], dwellMin: 40 },
        B: { id: 'B', name: 'B', coord: [0, 0], dwellMin: 40 },
      },
    };
    const order = ['A', 'B'];
    const suggestions = adviseInfeasible(order, ctx);
    const types = suggestions.map((s) => s.type);
    expect(types).toContain('extendEnd');
    expect(types).toContain('dropStore');
    const drop = suggestions.find((s) => s.type === 'dropStore') as
      | { type: 'dropStore'; storeId: string }
      | undefined;
    expect(drop?.storeId).toBeDefined();
  });

  it('suggests relaxing locked stops', () => {
    const MILE_TO_DEG = 1 / 69;
    const ctx: ScheduleCtx = {
      start: { id: 'S', name: 'S', coord: [0, 0] },
      end: { id: 'E', name: 'E', coord: [10 * MILE_TO_DEG, 0] },
      window: { start: '00:00', end: '00:20' },
      mph: 60,
      defaultDwellMin: 0,
      stores: {
        A: { id: 'A', name: 'A', coord: [1 * MILE_TO_DEG, 0] },
        B: { id: 'B', name: 'B', coord: [9 * MILE_TO_DEG, 0] },
      },
      locks: [{ storeId: 'B', index: 0 }],
    };
    const order = ['B', 'A'];
    const suggestions = adviseInfeasible(order, ctx);
    const types = suggestions.map((s) => s.type);
    expect(types).toContain('relaxLock');
    const relax = suggestions.find(
      (s) => s.type === 'relaxLock' && s.storeId === 'B',
    ) as { type: 'relaxLock'; storeId: string; minutesSaved: number } | undefined;
    expect(relax).toBeDefined();
    expect(relax!.minutesSaved).toBeGreaterThan(0);
  });
});
