import { describe, it, expect } from 'vitest';
import { planDay } from '../src/heuristics';
import { isFeasible } from '../src/schedule';
import type { HeuristicCtx } from '../src/heuristics';
import seedrandom from 'seedrandom';
import { performance } from 'node:perf_hooks';

const MILE_TO_DEG = 1 / 69; // Approximate degrees per mile at the equator

function buildSyntheticCtx(): HeuristicCtx {
  return {
    start: { id: 'S', name: 'start', coord: [0, 0] },
    end: { id: 'E', name: 'end', coord: [10 * MILE_TO_DEG, 0] },
    window: { start: '08:00', end: '18:00' },
    mph: 60,
    defaultDwellMin: 0,
    stores: {
      A: { id: 'A', name: 'A', coord: [2 * MILE_TO_DEG, 0] },
      B: { id: 'B', name: 'B', coord: [5 * MILE_TO_DEG, 0] },
      C: { id: 'C', name: 'C', coord: [8 * MILE_TO_DEG, 0] },
    },
    mustVisitIds: ['B'],
    candidateIds: ['A', 'B', 'C'],
    seed: 42,
  };
}

describe('synthetic day scenarios', () => {
  it('produces feasible schedules including must-visits', () => {
    const ctx = buildSyntheticCtx();
    const order = planDay(ctx);
    expect(isFeasible(order, ctx)).toBe(true);
    for (const id of ctx.mustVisitIds!) {
      expect(order).toContain(id);
    }
  });

  it('is deterministic with a fixed seed', () => {
    const order1 = planDay(buildSyntheticCtx());
    const order2 = planDay(buildSyntheticCtx());
    expect(order1).toEqual(order2);
  });
});

function buildRandomCtx(count: number, seed = 1): HeuristicCtx {
  const rng = seedrandom(String(seed));
  const stores: HeuristicCtx['stores'] = {};
  const candidateIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `S${i}`;
    const coord: [number, number] = [
      rng() * 100 * MILE_TO_DEG,
      rng() * 100 * MILE_TO_DEG,
    ];
    stores[id] = { id, name: id, coord };
    candidateIds.push(id);
  }
  return {
    start: { id: 'S', name: 'start', coord: [0, 0] },
    end: {
      id: 'E',
      name: 'end',
      coord: [100 * MILE_TO_DEG, 100 * MILE_TO_DEG],
    },
    window: { start: '08:00', end: '20:00' },
    mph: 60,
    defaultDwellMin: 0,
    stores,
    candidateIds,
    seed,
  };
}

describe('performance', () => {
  it(
    'solves large random days within time',
    () => {
      const ctx = buildRandomCtx(100, 123);
      const start = performance.now();
      const order = planDay(ctx);
      const duration = performance.now() - start;
      expect(isFeasible(order, ctx)).toBe(true);
      expect(order.length).toBeGreaterThan(0);
      expect(order.length).toBeLessThanOrEqual(ctx.candidateIds.length);
      expect(duration).toBeLessThan(30000);
    },
    { timeout: 30000 }
  );

  it(
    'scales to very large candidate sets',
    () => {
      const ctx = buildRandomCtx(300, 456);
      const start = performance.now();
      const order = planDay(ctx);
      const duration = performance.now() - start;
      expect(isFeasible(order, ctx)).toBe(true);
      expect(order.length).toBeLessThanOrEqual(ctx.candidateIds.length);
      expect(duration).toBeLessThan(60000);
    },
    { timeout: 120000 }
  );
});

