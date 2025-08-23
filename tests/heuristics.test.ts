import { describe, it, expect } from 'vitest';
import { planDay } from '../src/heuristics';
import type { HeuristicCtx } from '../src/heuristics';

describe('heuristics', () => {
  function buildCtx(): HeuristicCtx {
    return {
      start: { id: 'S', name: 'start', coord: [0, 0] },
      end: { id: 'E', name: 'end', coord: [10, 0] },
      window: { start: '00:00', end: '23:59' },
      mph: 60,
      defaultDwellMin: 0,
      stores: {
        A: { id: 'A', name: 'A', coord: [2, 0] },
        B: { id: 'B', name: 'B', coord: [5, 0] },
        C: { id: 'C', name: 'C', coord: [8, 0] },
      },
      mustVisitIds: ['B'],
      candidateIds: ['A', 'B', 'C'],
      seed: 1,
    };
  }

  it('seeds must-visits and inserts greedily', () => {
    const ctx = buildCtx();
    const order = planDay(ctx);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('is deterministic with fixed seed', () => {
    const ctx1 = buildCtx();
    const ctx2 = buildCtx();
    const a = planDay(ctx1);
    const b = planDay(ctx2);
    expect(a).toEqual(b);
  });
});

