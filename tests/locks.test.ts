import { describe, it, expect } from 'vitest';
import { planDay } from '../src/heuristics';
import type { HeuristicCtx } from '../src/heuristics';

describe('locks', () => {
  it('respects fixed indices', () => {
    const ctx: HeuristicCtx = {
      start: { id: 'S', name: 'start', coord: [0, 0] },
      end: { id: 'E', name: 'end', coord: [10, 0] },
      window: { start: '00:00', end: '23:59' },
      mph: 60,
      defaultDwellMin: 0,
      stores: {
        A: { id: 'A', name: 'A', coord: [2, 0] },
        B: { id: 'B', name: 'B', coord: [4, 0] },
        C: { id: 'C', name: 'C', coord: [6, 0] },
        D: { id: 'D', name: 'D', coord: [8, 0] },
      },
      candidateIds: ['A', 'B', 'C', 'D'],
      locks: [
        { storeId: 'A', position: 'firstAfterStart' },
        { storeId: 'B', index: 1 },
      ],
    };
    const order = planDay(ctx);
    expect(order[0]).toBe('A');
    expect(order[1]).toBe('B');
  });

  it('keeps relative positions', () => {
    const ctx: HeuristicCtx = {
      start: { id: 'S', name: 'start', coord: [0, 0] },
      end: { id: 'E', name: 'end', coord: [10, 0] },
      window: { start: '00:00', end: '23:59' },
      mph: 60,
      defaultDwellMin: 0,
      stores: {
        A: { id: 'A', name: 'A', coord: [1, 0] },
        B: { id: 'B', name: 'B', coord: [2, 0] },
        C: { id: 'C', name: 'C', coord: [3, 0] },
        D: { id: 'D', name: 'D', coord: [4, 0] },
      },
      candidateIds: ['A', 'B', 'C', 'D'],
      locks: [
        { storeId: 'A', position: 'firstAfterStart' },
        { storeId: 'B', afterStoreId: 'A' },
        { storeId: 'D', position: 'lastBeforeEnd' },
      ],
    };
    const order = planDay(ctx);
    const idxA = order.indexOf('A');
    const idxB = order.indexOf('B');
    expect(idxA).toBe(0);
    expect(idxB).toBe(idxA + 1);
    expect(order[order.length - 1]).toBe('D');
  });
});
