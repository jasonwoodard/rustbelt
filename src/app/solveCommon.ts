import { readFileSync } from 'node:fs';
import { parseTrip } from '../io/parse';
import { planDay, type ProgressFn } from '../heuristics';
import {
  computeTimeline,
  slackMin,
  isFeasible,
  type ScheduleCtx,
  onTimeRisk,
} from '../schedule';
import { adviseInfeasible } from '../infeasibility';
import type { InfeasibilitySuggestion } from '../infeasibility';
import { hhmmToMin } from '../time';
import type { ID, Store, DayPlan, LockSpec, Coord, Weekday } from '../types';
import { BREAK_ID } from '../types';

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
  lambda?: number;
  robustnessFactor?: number;
  riskThresholdMin?: number;
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

export interface SolveCommonResult {
  dayPlan: DayPlan;
  runId?: string;
  note?: string;
}

export function solveCommon(opts: SolveCommonOptions): SolveCommonResult {
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
  const robustnessFactor =
    opts.robustnessFactor ??
    day.robustnessFactor ??
    trip.config.robustnessFactor ??
    1;
  const riskThresholdMin =
    opts.riskThresholdMin ??
    day.riskThresholdMin ??
    trip.config.riskThresholdMin ??
    0;

  const stores: Record<ID, Store> = {};
  let candidateIds: ID[] = [];
  function isOpenOnDay(store: Store, dow: Weekday): boolean {
    if (!store.openHours) return true;
    const windows = store.openHours[dow];
    return !!(windows && windows.length > 0);
  }
  for (const s of trip.stores) {
    if (!s.dayId || s.dayId === day.dayId) {
      if (!day.dayOfWeek || isOpenOnDay(s, day.dayOfWeek)) {
        stores[s.id] = s;
        candidateIds.push(s.id);
      }
    }
  }

  if (opts.completedIds) {
    const done = new Set(opts.completedIds);
    candidateIds = candidateIds.filter((id) => !done.has(id));
  }

  let mustVisitIds: ID[] | undefined = day.mustVisitIds?.filter((id) =>
    candidateIds.includes(id),
  );
  const taggedMustVisitIds = candidateIds.filter((id) =>
    (stores[id].tags ?? []).some((t) => /must[-_]?visit/i.test(t)),
  );
  if (taggedMustVisitIds.length > 0) {
    mustVisitIds = [
      ...new Set([...(mustVisitIds ?? []), ...taggedMustVisitIds]),
    ];
  }
  if (mustVisitIds && mustVisitIds.length === 0) {
    mustVisitIds = undefined;
  }
  let locks = (opts.locks ?? day.locks)?.filter((l) => candidateIds.includes(l.storeId));

  if (day.breakWindow) {
    mustVisitIds = [...(mustVisitIds ?? []), BREAK_ID];
  }

  const start = { ...day.start, coord: opts.startCoord ?? day.start.coord };
  const window = { start: opts.windowStart ?? day.window.start, end: day.window.end };

  const baseCtx: ScheduleCtx = {
    start,
    end: day.end,
    window,
    mph,
    defaultDwellMin,
    stores,
    maxDriveTime: day.maxDriveTime,
    maxStops: day.maxStops,
    breakWindow: day.breakWindow,
    robustnessFactor,
    dayOfWeek: day.dayOfWeek,
  };

  if (opts.completedIds || opts.startCoord || opts.windowStart) {
    candidateIds = candidateIds.filter((id) =>
      isFeasible(day.breakWindow ? [id, BREAK_ID] : [id], baseCtx),
    );
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
    lambda: opts.lambda,
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

  let totalScore = 0;
  for (const id of order) {
    totalScore += ctx.stores[id]?.score ?? 0;
  }
  const storeVisits = order.filter((id) => id !== BREAK_ID).length;

  const limitViolations: string[] = [];
  const bindingConstraints: string[] = [];
  if (ctx.maxDriveTime != null) {
    if (timeline.totalDriveMin > ctx.maxDriveTime + 1e-9) {
      limitViolations.push('maxDriveTime');
    } else if (Math.abs(timeline.totalDriveMin - ctx.maxDriveTime) < 1e-9) {
      bindingConstraints.push('maxDriveTime');
    }
  }
  if (ctx.maxStops != null) {
    if (storeVisits > ctx.maxStops) {
      limitViolations.push('maxStops');
    } else if (storeVisits === ctx.maxStops) {
      bindingConstraints.push('maxStops');
    }
  }

  const dayPlan: DayPlan = {
    dayId: day.dayId,
    stops: timeline.stops,
    metrics: {
      storesVisited: storeVisits,
      totalScore,
      totalDriveMin: timeline.totalDriveMin,
      totalDwellMin: timeline.totalDwellMin,
      slackMin: slackMin(order, ctx),
      onTimeRisk: onTimeRisk(timeline, ctx.window.end, riskThresholdMin),
      limitViolations: limitViolations.length ? limitViolations : undefined,
      bindingConstraints: bindingConstraints.length
        ? bindingConstraints
        : undefined,
    },
  };

  return { dayPlan, runId: trip.config.runId, note: trip.config.runNote };
}

