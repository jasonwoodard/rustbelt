import seedrandom from 'seedrandom';
import {
  computeTimeline,
  isFeasible,
  slackMin,
  ScheduleCtx,
} from './schedule';
import { haversineMiles } from './distance';
import type { ID } from './types';
import { hhmmToMin } from './time';

export interface HeuristicCtx extends ScheduleCtx {
  candidateIds: ID[];
  seed?: number;
  verbose?: boolean;
}

export function planDay(ctx: HeuristicCtx): ID[] {
  const rng = seedrandom(String(ctx.seed ?? 0));
  const order = seedMustVisits(ctx, rng);
  if (!isFeasible(order, ctx)) {
    const { hotelETAmin } = computeTimeline(order, ctx);
    const endMin = hhmmToMin(ctx.window.end);
    const deficit = hotelETAmin - endMin;
    throw new Error(`must visits exceed day window by ${Math.round(deficit)} min`);
  }
  const remaining = ctx.candidateIds.filter((id) => !order.includes(id));
  greedyInsert(order, remaining, ctx, rng);
  twoOpt(order, ctx);
  relocate(order, ctx);
  return order;
}

function seedMustVisits(
  ctx: HeuristicCtx,
  rng: seedrandom.PRNG,
): ID[] {
  const { mustVisitIds } = ctx;
  if (!mustVisitIds || mustVisitIds.length === 0) return [];
  const remaining = mustVisitIds.filter((id) => ctx.stores[id]);
  const order: ID[] = [];
  let currentCoord = ctx.start.coord;
  while (remaining.length > 0) {
    let bestDist = Infinity;
    const bestIds: ID[] = [];
    for (const id of remaining) {
      const dist = haversineMiles(currentCoord, ctx.stores[id].coord);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        bestIds.length = 0;
        bestIds.push(id);
      } else if (Math.abs(dist - bestDist) < 1e-9) {
        bestIds.push(id);
      }
    }
    const pick = bestIds[Math.floor(rng() * bestIds.length)];
    order.push(pick);
    currentCoord = ctx.stores[pick].coord;
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return order;
}

function greedyInsert(
  order: ID[],
  remaining: ID[],
  ctx: HeuristicCtx,
  rng: seedrandom.PRNG,
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
      for (let pos = 0; pos <= order.length; pos++) {
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

function twoOpt(order: ID[], ctx: HeuristicCtx): void {
  let improved = true;
  while (improved) {
    improved = false;
    const baseSlack = slackMin(order, ctx);
    const baseDrive = computeTimeline(order, ctx).totalDriveMin;
    outer: for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
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

function relocate(order: ID[], ctx: HeuristicCtx): void {
  let improved = true;
  while (improved) {
    improved = false;
    const baseSlack = slackMin(order, ctx);
    const baseDrive = computeTimeline(order, ctx).totalDriveMin;
    outer: for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const removed = order.slice();
      removed.splice(i, 1);
      for (let j = 0; j <= removed.length; j++) {
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

