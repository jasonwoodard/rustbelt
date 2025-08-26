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
});
