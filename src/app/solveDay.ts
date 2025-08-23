import { readFileSync } from 'node:fs';
import { parseTrip } from '../io/parse';
import { planDay } from '../heuristics';
import { computeTimeline, slackMin, isFeasible } from '../schedule';
import { emitItinerary, EmitResult } from '../io/emit';
import type { ID, Store, DayPlan } from '../types';

export interface SolveDayOptions {
  tripPath: string;
  dayId: string;
  mph?: number;
  defaultDwellMin?: number;
  seed?: number;
}

function hhmmToMin(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

export function solveDay(opts: SolveDayOptions): EmitResult {
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
  const candidateIds: ID[] = [];
  for (const s of trip.stores) {
    if (!s.dayId || s.dayId === day.dayId) {
      stores[s.id] = s;
      candidateIds.push(s.id);
    }
  }

  const ctx = {
    start: day.start,
    end: day.end,
    window: day.window,
    mph,
    defaultDwellMin,
    stores,
    mustVisitIds: day.mustVisitIds,
    candidateIds,
    seed: opts.seed ?? trip.config.seed,
  };

  const order = planDay(ctx);
  const feasible = isFeasible(order, ctx);
  const timeline = computeTimeline(order, ctx);
  if (!feasible) {
    const endMin = hhmmToMin(ctx.window.end);
    const deficit = timeline.hotelETAmin - endMin;
    throw new Error(`must visits exceed day window by ${Math.round(deficit)} min`);
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

  return emitItinerary([dayPlan]);
}
