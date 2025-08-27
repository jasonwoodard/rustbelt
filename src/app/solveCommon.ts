import { readFileSync } from 'node:fs';
import { parseTrip } from '../io/parse';
import { planDay, type ProgressFn } from '../heuristics';
import { computeTimeline, slackMin, isFeasible, type ScheduleCtx } from '../schedule';
import { adviseInfeasible } from '../infeasibility';
import type { InfeasibilitySuggestion } from '../infeasibility';
import { hhmmToMin } from '../time';
import type { ID, Store, DayPlan, LockSpec, Coord } from '../types';

export interface SolveCommonOptions {
  tripPath: string;
  dayId: string;
  startCoord?: Coord;
  windowStart?: string;
  mph?: number;
  defaultDwellMin?: number;
  seed?: number;
  verbose?: boolean;
  locks?: LockSpec[];
  completedIds?: ID[];
  progress?: ProgressFn;
}

export function augmentErrorWithReasons(err: unknown): Error {
  const e = err as Error & { suggestions?: InfeasibilitySuggestion[] };
  if (e.suggestions && !e.message.includes('reasons:')) {
    const reasons = Array.from(
      new Set(e.suggestions.map((s) => s.reason)),
    ).join('; ');
    const newErr = new Error(`${e.message}; reasons: ${reasons}`);
    (newErr as Error & { suggestions?: unknown[] }).suggestions = e.suggestions;
    return newErr;
  }
  return e;
}

export function solveCommon(opts: SolveCommonOptions): DayPlan {
  const raw = readFileSync(opts.tripPath, 'utf8');
  const json = JSON.parse(raw);
  const trip = parseTrip(json);

  const day = trip.days.find((d) => d.dayId === opts.dayId);
  if (!day) {
    throw new Error(`Day not found: ${opts.dayId}`);
  }

  const mph = opts.mph ?? day.mph ?? trip.config.mph ?? 30;
  const defaultDwellMin =
    opts.defaultDwellMin ??
    day.defaultDwellMin ??
    trip.config.defaultDwellMin ??
    0;

  const stores: Record<ID, Store> = {};
  let candidateIds: ID[] = [];
  for (const s of trip.stores) {
    if (!s.dayId || s.dayId === day.dayId) {
      stores[s.id] = s;
      candidateIds.push(s.id);
    }
  }

  if (opts.completedIds) {
    const done = new Set(opts.completedIds);
    candidateIds = candidateIds.filter((id) => !done.has(id));
  }

  let mustVisitIds = day.mustVisitIds?.filter((id) => candidateIds.includes(id));
  let locks = (opts.locks ?? day.locks)?.filter((l) => candidateIds.includes(l.storeId));

  const start = { ...day.start, coord: opts.startCoord ?? day.start.coord };
  const window = { start: opts.windowStart ?? day.window.start, end: day.window.end };

  const baseCtx: ScheduleCtx = {
    start,
    end: day.end,
    window,
    mph,
    defaultDwellMin,
    stores,
  };

  if (opts.completedIds || opts.startCoord || opts.windowStart) {
    candidateIds = candidateIds.filter((id) => isFeasible([id], baseCtx));
    mustVisitIds = mustVisitIds?.filter((id) => candidateIds.includes(id));
    locks = locks?.filter((l) => candidateIds.includes(l.storeId));
  }

  const ctx = {
    ...baseCtx,
    mustVisitIds,
    locks,
    candidateIds,
    seed: opts.seed ?? trip.config.seed,
    verbose: opts.verbose,
    progress: opts.progress,
  };

  let order: ID[];
  try {
    order = planDay(ctx);
  } catch (err) {
    const adviceOrder = Array.from(
      new Set([
        ...(ctx.mustVisitIds ?? []),
        ...(ctx.locks?.map((l) => l.storeId) ?? []),
      ]),
    );
    const suggestions = adviseInfeasible(adviceOrder, ctx);
    const reasons = Array.from(new Set(suggestions.map((s) => s.reason))).join(
      '; ',
    );
    const newErr = new Error(
      `${(err as Error).message}; reasons: ${reasons}; suggestions: ${JSON.stringify(
        suggestions,
      )}`,
    );
    (newErr as Error & { suggestions?: unknown[] }).suggestions = suggestions;
    throw newErr;
  }
  const feasible = isFeasible(order, ctx);
  const timeline = computeTimeline(order, ctx);
  if (!feasible) {
    const suggestions = adviseInfeasible(order, ctx);
    const endMin = hhmmToMin(ctx.window.end);
    const deficit = timeline.hotelETAmin - endMin;
    const reasons = Array.from(new Set(suggestions.map((s) => s.reason))).join(
      '; ',
    );
    const err = new Error(
      `must visits exceed day window by ${Math.round(
        deficit,
      )} min; reasons: ${reasons}; suggestions: ${JSON.stringify(suggestions)}`,
    );
    (err as Error & { suggestions?: unknown[] }).suggestions = suggestions;
    throw err;
  }

  const dayPlan: DayPlan = {
    dayId: day.dayId,
    stops: timeline.stops,
    metrics: {
      storesVisited: order.length,
      totalDriveMin: timeline.totalDriveMin,
      totalDwellMin: timeline.totalDwellMin,
      slackMin: slackMin(order, ctx),
    },
  };

  return dayPlan;
}

