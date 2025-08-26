import seedrandom from 'seedrandom';
import {
  computeTimeline,
  isFeasible,
  slackMin,
  ScheduleCtx,
} from './schedule';
import type { ID, LockSpec } from './types';
import { hhmmToMin } from './time';

export interface HeuristicCtx extends ScheduleCtx {
  candidateIds: ID[];
  seed?: number;
  verbose?: boolean;
  locks?: LockSpec[];
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
  twoOpt(order, ctx, prefix, suffix);
  relocate(order, ctx, prefix, suffix);
  return order;
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
    const base = computeTimeline(order, ctx);
    const baseEta = base.hotelETAmin;
    let bestId: ID | null = null;
    let bestPos = -1;
    let bestDelta = Infinity;
    let bestSlack = -Infinity;
    let bestDrive = Infinity;
    for (const id of remaining) {
      for (let pos = prefix; pos <= order.length - suffix; pos++) {
        const candidate = order.slice();
        candidate.splice(pos, 0, id);
        if (!isFeasible(candidate, ctx)) continue;
        const t = computeTimeline(candidate, ctx);
        const delta = t.hotelETAmin - baseEta;
        const slack = slackMin(candidate, ctx);
        if (
          delta < bestDelta - 1e-9 ||
          (Math.abs(delta - bestDelta) < 1e-9 &&
            (slack > bestSlack + 1e-9 ||
              (Math.abs(slack - bestSlack) < 1e-9 &&
                (t.totalDriveMin < bestDrive - 1e-9 ||
                  (Math.abs(t.totalDriveMin - bestDrive) < 1e-9 &&
                    rng() < 0.5)))))
        ) {
          bestId = id;
          bestPos = pos;
          bestDelta = delta;
          bestSlack = slack;
          bestDrive = t.totalDriveMin;
        }
      }
    }
    if (bestId == null) break;
    order.splice(bestPos, 0, bestId);
    remaining.splice(remaining.indexOf(bestId), 1);
    if (ctx.verbose) {
      console.log(`insert ${bestId} at ${bestPos}`);
    }
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
    const baseSlack = slackMin(order, ctx);
    const baseDrive = computeTimeline(order, ctx).totalDriveMin;
    outer: for (let i = prefix; i < order.length - suffix - 1; i++) {
      for (let j = i + 1; j < order.length - suffix; j++) {
        const before = order.slice(i, j + 1);
        const candidate = order.slice();
        const segment = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, segment.length, ...segment);
        if (!isFeasible(candidate, ctx)) continue;
        const slack = slackMin(candidate, ctx);
        const drive = computeTimeline(candidate, ctx).totalDriveMin;
        if (slack > baseSlack + 1e-9 ||
          (Math.abs(slack - baseSlack) < 1e-9 && drive < baseDrive - 1e-9)
        ) {
          order.splice(0, order.length, ...candidate);
          if (ctx.verbose) {
            const after = candidate.slice(i, j + 1);
            console.log('2-opt swap', before, '->', after);
          }
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
        const slack = slackMin(candidate, ctx);
        const drive = computeTimeline(candidate, ctx).totalDriveMin;
        if (slack > baseSlack + 1e-9 ||
          (Math.abs(slack - baseSlack) < 1e-9 && drive < baseDrive - 1e-9)
        ) {
          order.splice(0, order.length, ...candidate);
          if (ctx.verbose) {
            console.log(`relocate ${id} from ${i} to ${j}`);
          }
          improved = true;
          break outer;
        }
      }
    }
  }
}

