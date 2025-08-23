import { minutesAtMph, haversineMiles } from './distance';
import type {
  Anchor,
  Store,
  ID,
  Coord,
  StopPlan,
} from './types';

export interface ScheduleCtx {
  start: Anchor;
  end: Anchor;
  window: { start: string; end: string };
  mph: number;
  defaultDwellMin: number;
  stores: Record<ID, Store>;
  mustVisitIds?: ID[];
}

export interface TimelineResult {
  stops: StopPlan[];
  totalDriveMin: number;
  totalDwellMin: number;
  hotelETAmin: number;
}

function hhmmToMin(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function legMetrics(
  from: Coord,
  to: Coord,
  mph: number,
): { dist: number; driveMin: number } {
  const dist = haversineMiles(from, to);
  return { dist, driveMin: minutesAtMph(dist, mph) };
}

export function computeTimeline(order: ID[], ctx: ScheduleCtx): TimelineResult {
  const startMin = hhmmToMin(ctx.window.start);
  const stops: StopPlan[] = [];

  let totalDriveMin = 0;
  let totalDwellMin = 0;
  let currentTime = startMin;
  let currentId: ID = ctx.start.id;
  let currentCoord: Coord = ctx.start.coord;

  // start stop
  stops.push({
    id: ctx.start.id,
    type: 'start',
    arrive: minToHhmm(currentTime),
    depart: minToHhmm(currentTime),
  });

  for (const id of order) {
    const store = ctx.stores[id];
    if (!store) {
      throw new Error(`Unknown store id: ${id}`);
    }

    const { dist, driveMin } = legMetrics(
      currentCoord,
      store.coord,
      ctx.mph,
    );
    currentTime += driveMin;
    totalDriveMin += driveMin;

    const dwell = store.dwellMin ?? ctx.defaultDwellMin;
    const arriveMin = currentTime;
    currentTime += dwell;
    totalDwellMin += dwell;

    stops.push({
      id: store.id,
      type: 'store',
      arrive: minToHhmm(arriveMin),
      depart: minToHhmm(currentTime),
      dwellMin: dwell,
      legIn: {
        fromId: currentId,
        toId: store.id,
        driveMin,
        distanceMi: dist,
      },
    });

    currentId = store.id;
    currentCoord = store.coord;
  }

  // leg to end
  const { dist, driveMin } = legMetrics(
    currentCoord,
    ctx.end.coord,
    ctx.mph,
  );
  currentTime += driveMin;
  totalDriveMin += driveMin;

  stops.push({
    id: ctx.end.id,
    type: 'end',
    arrive: minToHhmm(currentTime),
    depart: minToHhmm(currentTime),
    legIn: {
      fromId: currentId,
      toId: ctx.end.id,
      driveMin,
      distanceMi: dist,
    },
  });

  return { stops, totalDriveMin, totalDwellMin, hotelETAmin: currentTime };
}

export function isFeasible(order: ID[], ctx: ScheduleCtx): boolean {
  if (ctx.mustVisitIds) {
    for (const id of ctx.mustVisitIds) {
      if (!order.includes(id)) {
        return false;
      }
    }
  }

  const { hotelETAmin } = computeTimeline(order, ctx);
  const endMin = hhmmToMin(ctx.window.end);
  return hotelETAmin <= endMin;
}

export function slackMin(order: ID[], ctx: ScheduleCtx): number {
  const { hotelETAmin } = computeTimeline(order, ctx);
  const endMin = hhmmToMin(ctx.window.end);
  return Math.max(0, endMin - hotelETAmin);
}

