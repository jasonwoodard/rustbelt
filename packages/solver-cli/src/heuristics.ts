import seedrandom from 'seedrandom';
import {
  computeTimeline,
  isFeasible,
  slackMin,
  ScheduleCtx,
  buildDistanceMatrix,
  assessFeasibility,
  type FeasibilityReason,
} from './schedule';
import type { ID, LockSpec } from './types';
import { hhmmToMin } from './time';
import { BREAK_ID } from './types';

export interface HeuristicCtx extends ScheduleCtx {
  candidateIds: ID[];
  seed?: number;
  verbose?: boolean;
  locks?: LockSpec[];
  progress?: ProgressFn;
  lambda?: number;
  exclusionLog?: Map<ID, FeasibilityReason>;
}

export interface ProgressMetrics {
  slackMin: number;
  totalDriveMin: number;
  hotelETAmin: number;
}

export type ProgressFn = (
  phase: 'greedy' | '2-opt' | 'relocate',
  order: ID[],
  metrics: ProgressMetrics,
) => void;

function totalScore(order: ID[], ctx: HeuristicCtx): number {
  let sum = 0;
  for (const id of order) {
    sum += ctx.stores[id]?.score ?? 0;
  }
  return sum;
}

function storeCount(order: ID[]): number {
  return order.filter((id) => id !== BREAK_ID).length;
}

function objective(order: ID[], ctx: HeuristicCtx): number {
  const lambda = ctx.lambda ?? 0;
  return lambda * totalScore(order, ctx) + (1 - lambda) * order.length;
}

interface LockPlacement {
  order: ID[];
  prefix: number;
  suffix: number;
}

function applyLocks(ctx: HeuristicCtx): LockPlacement {
  const prefix: ID[] = [];
  const suffix: ID[] = [];
  for (const lock of ctx.locks ?? []) {
    const id = lock.storeId;
    if (!ctx.stores[id]) continue;
    if ('position' in lock) {
      if (lock.position === 'firstAfterStart') {
        prefix.splice(0, 0, id);
      } else if (lock.position === 'lastBeforeEnd') {
        suffix.push(id);
      }
    } else if ('index' in lock) {
      const idx = Math.min(lock.index, prefix.length);
      prefix.splice(idx, 0, id);
    } else if ('afterStoreId' in lock) {
      const idx = prefix.indexOf(lock.afterStoreId);
      if (idx !== -1) {
        prefix.splice(idx + 1, 0, id);
      }
    }
  }
  return { order: prefix.concat(suffix), prefix: prefix.length, suffix: suffix.length };
}

function seedMustVisits(
  order: ID[],
  ctx: HeuristicCtx,
  prefix = 0,
  suffix = 0,
): void {
  const ids = ctx.mustVisitIds;
  if (!ids) return;
  for (const id of ids) {
    if (!ctx.stores[id] || order.includes(id)) continue;
    let bestPos = prefix;
    let bestEta = Infinity;
    for (let pos = prefix; pos <= order.length - suffix; pos++) {
      const candidate = order.slice();
      candidate.splice(pos, 0, id);
      const eta = computeTimeline(candidate, ctx).hotelETAmin;
      if (eta < bestEta - 1e-9) {
        bestEta = eta;
        bestPos = pos;
      }
    }
    order.splice(bestPos, 0, id);
  }
}

export function planDay(ctx: HeuristicCtx): ID[] {
  if (!ctx.distanceMatrix) {
    ctx.distanceMatrix = buildDistanceMatrix(ctx);
  }
  const startMin = hhmmToMin(ctx.window.start);
  const endMin = hhmmToMin(ctx.window.end);
  const windowMin = endMin - startMin;
  const driveMin = computeTimeline([], ctx).totalDriveMin;
  if (driveMin >= windowMin) {
    throw new Error(
      `start to end drive time ${Math.round(driveMin)} min >= window ${windowMin} min`,
    );
  }
  const rng = seedrandom(String(ctx.seed ?? 0));
  const { order, prefix, suffix } = applyLocks(ctx);
  seedMustVisits(order, ctx, prefix, suffix);
  if (!isFeasible(order, ctx)) {
    const { hotelETAmin } = computeTimeline(order, ctx);
    const endMin = hhmmToMin(ctx.window.end);
    const deficit = hotelETAmin - endMin;
    throw new Error(`must visits exceed day window by ${Math.round(deficit)} min`);
  }
  const remaining = ctx.candidateIds.filter((id) => !order.includes(id));
  greedyInsert(order, remaining, ctx, rng, prefix, suffix);
  reportProgress('greedy', order, ctx);
  twoOpt(order, ctx, prefix, suffix);
  reportProgress('2-opt', order, ctx);
  relocate(order, ctx, prefix, suffix);
  reportProgress('relocate', order, ctx);
  return order;
}

function reportProgress(
  phase: 'greedy' | '2-opt' | 'relocate',
  order: ID[],
  ctx: HeuristicCtx,
): void {
  if (!ctx.progress) return;
  const t = computeTimeline(order, ctx);
  ctx.progress(phase, order.slice(), {
    slackMin: slackMin(order, ctx),
    totalDriveMin: t.totalDriveMin,
    hotelETAmin: t.hotelETAmin,
  });
}

function greedyInsert(
  order: ID[],
  remaining: ID[],
  ctx: HeuristicCtx,
  rng: seedrandom.PRNG,
  prefix = 0,
  suffix = 0,
): void {
  while (remaining.length > 0) {
    if (ctx.maxStops != null && storeCount(order) >= ctx.maxStops) {
      if (ctx.exclusionLog) {
        for (const id of remaining) {
          ctx.exclusionLog.set(id, { type: 'maxStops', limit: ctx.maxStops });
        }
      }
      break;
    }
    const base = computeTimeline(order, ctx);
    const baseEta = base.hotelETAmin;
    let bestId: ID | null = null;
    let bestPos = -1;
    let bestValue = -Infinity;
    let bestDelta = Infinity;
    let bestSlack = -Infinity;
    let bestDrive = Infinity;
    const lambda = ctx.lambda ?? 0;
    const iterationReasons = new Map<ID, FeasibilityReason>();
    for (const id of remaining) {
      const storeVal =
        lambda * (ctx.stores[id]?.score ?? 0) + (1 - lambda);
      let idReason: FeasibilityReason | undefined;
      let feasibleForId = false;
      for (let pos = prefix; pos <= order.length - suffix; pos++) {
        const candidate = order.slice();
        candidate.splice(pos, 0, id);
        if (ctx.maxStops != null && storeCount(candidate) > ctx.maxStops)
          continue;
        const feas = assessFeasibility(candidate, ctx);
        if (!feas.feasible) {
          if (feas.reason) {
            idReason = feas.reason;
          }
          continue;
        }
        const t = feas.timeline ?? computeTimeline(candidate, ctx);
        const delta = t.hotelETAmin - baseEta;
        const slack = slackMin(candidate, ctx);
        if (
          storeVal > bestValue + 1e-9 ||
          (Math.abs(storeVal - bestValue) < 1e-9 &&
            (delta < bestDelta - 1e-9 ||
              (Math.abs(delta - bestDelta) < 1e-9 &&
                (slack > bestSlack + 1e-9 ||
                  (Math.abs(slack - bestSlack) < 1e-9 &&
                    (t.totalDriveMin < bestDrive - 1e-9 ||
                      (Math.abs(t.totalDriveMin - bestDrive) < 1e-9 &&
                        rng() < 0.5)))))))
        ) {
          bestId = id;
          bestPos = pos;
          bestValue = storeVal;
          bestDelta = delta;
          bestSlack = slack;
          bestDrive = t.totalDriveMin;
        }
        feasibleForId = true;
      }
      if (!feasibleForId && idReason) {
        iterationReasons.set(id, idReason);
      }
    }
    if (bestId == null) {
      if (ctx.exclusionLog) {
        for (const id of remaining) {
          const reason = iterationReasons.get(id);
          if (reason) {
            ctx.exclusionLog.set(id, reason);
          }
        }
      }
      break;
    }
    order.splice(bestPos, 0, bestId);
    remaining.splice(remaining.indexOf(bestId), 1);
    if (ctx.verbose) {
      console.log(`insert ${bestId} at ${bestPos}`);
    }
    reportProgress('greedy', order, ctx);
  }
}

function twoOpt(
  order: ID[],
  ctx: HeuristicCtx,
  prefix = 0,
  suffix = 0,
): void {
  let improved = true;
  while (improved) {
    improved = false;
    const baseObj = objective(order, ctx);
    const baseSlack = slackMin(order, ctx);
    const baseDrive = computeTimeline(order, ctx).totalDriveMin;
    outer: for (let i = prefix; i < order.length - suffix - 1; i++) {
      for (let j = i + 1; j < order.length - suffix; j++) {
        const before = order.slice(i, j + 1);
        const candidate = order.slice();
        const segment = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, segment.length, ...segment);
        if (!isFeasible(candidate, ctx)) continue;
        const candObj = objective(candidate, ctx);
        const slack = slackMin(candidate, ctx);
        const drive = computeTimeline(candidate, ctx).totalDriveMin;
        if (
          candObj > baseObj + 1e-9 ||
          (Math.abs(candObj - baseObj) < 1e-9 &&
            (slack > baseSlack + 1e-9 ||
              (Math.abs(slack - baseSlack) < 1e-9 &&
                drive < baseDrive - 1e-9)))
        ) {
          order.splice(0, order.length, ...candidate);
          if (ctx.verbose) {
            const after = candidate.slice(i, j + 1);
            console.log('2-opt swap', before, '->', after);
          }
          reportProgress('2-opt', order, ctx);
          improved = true;
          break outer;
        }
      }
    }
  }
}

function relocate(
  order: ID[],
  ctx: HeuristicCtx,
  prefix = 0,
  suffix = 0,
): void {
  let improved = true;
  while (improved) {
    improved = false;
    const baseObj = objective(order, ctx);
    const baseSlack = slackMin(order, ctx);
    const baseDrive = computeTimeline(order, ctx).totalDriveMin;
    outer: for (let i = prefix; i < order.length - suffix; i++) {
      const id = order[i];
      const removed = order.slice();
      removed.splice(i, 1);
      for (let j = prefix; j <= removed.length - suffix; j++) {
        if (j === i) continue;
        const candidate = removed.slice();
        candidate.splice(j, 0, id);
        if (!isFeasible(candidate, ctx)) continue;
        const candObj = objective(candidate, ctx);
        const slack = slackMin(candidate, ctx);
        const drive = computeTimeline(candidate, ctx).totalDriveMin;
        if (
          candObj > baseObj + 1e-9 ||
          (Math.abs(candObj - baseObj) < 1e-9 &&
            (slack > baseSlack + 1e-9 ||
              (Math.abs(slack - baseSlack) < 1e-9 &&
                drive < baseDrive - 1e-9)))
        ) {
          order.splice(0, order.length, ...candidate);
          if (ctx.verbose) {
            console.log(`relocate ${id} from ${i} to ${j}`);
          }
          reportProgress('relocate', order, ctx);
          improved = true;
          break outer;
        }
      }
    }
  }
}

