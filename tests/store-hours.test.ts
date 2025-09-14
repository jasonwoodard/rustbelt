import { describe, it, expect } from 'vitest';
import { isFeasible, type ScheduleCtx } from '../src/schedule';
import type { Store, Anchor } from '../src/types';

const start: Anchor = { id: 'S', name: 'start', coord: [0, 0] };
const end: Anchor = { id: 'E', name: 'end', coord: [0, 0] };

describe('store open hours', () => {
  it('rejects arrival before open', () => {
    const store: Store = {
      id: 'A',
      name: 'A',
      coord: [0, 0],
      openHours: { mon: [['09:00', '17:00']] },
    };
    const ctx: ScheduleCtx = {
      start,
      end,
      window: { start: '08:00', end: '18:00' },
      mph: 60,
      defaultDwellMin: 0,
      stores: { A: store },
      dayOfWeek: 'mon',
    };
    expect(isFeasible(['A'], ctx)).toBe(false);
  });

  it('rejects dwell crossing close', () => {
    const store: Store = {
      id: 'A',
      name: 'A',
      coord: [0, 0],
      openHours: { mon: [['10:00', '12:00']] },
    };
    const ctx: ScheduleCtx = {
      start,
      end,
      window: { start: '11:30', end: '18:00' },
      mph: 60,
      defaultDwellMin: 45,
      stores: { A: store },
      dayOfWeek: 'mon',
    };
    expect(isFeasible(['A'], ctx)).toBe(false);
  });

  it('rejects store closed on day', () => {
    const store: Store = {
      id: 'A',
      name: 'A',
      coord: [0, 0],
      openHours: { tue: [['09:00', '17:00']] },
    };
    const ctx: ScheduleCtx = {
      start,
      end,
      window: { start: '09:00', end: '18:00' },
      mph: 60,
      defaultDwellMin: 0,
      stores: { A: store },
      dayOfWeek: 'mon',
    };
    expect(isFeasible(['A'], ctx)).toBe(false);
  });

  it('rejects store with no open hours on day', () => {
    const store: Store = {
      id: 'A',
      name: 'A',
      coord: [0, 0],
      openHours: { mon: [] },
    };
    const ctx: ScheduleCtx = {
      start,
      end,
      window: { start: '09:00', end: '18:00' },
      mph: 60,
      defaultDwellMin: 0,
      stores: { A: store },
      dayOfWeek: 'mon',
    };
    expect(isFeasible(['A'], ctx)).toBe(false);
  });

  it('accepts when within open window', () => {
    const store: Store = {
      id: 'A',
      name: 'A',
      coord: [0, 0],
      openHours: { mon: [['09:00', '17:00']] },
    };
    const ctx: ScheduleCtx = {
      start,
      end,
      window: { start: '10:00', end: '18:00' },
      mph: 60,
      defaultDwellMin: 0,
      stores: { A: store },
      dayOfWeek: 'mon',
    };
    expect(isFeasible(['A'], ctx)).toBe(true);
  });
});
