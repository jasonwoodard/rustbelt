import { driveMinutes, haversineMiles, buildMatrix } from './cost';
import type {
  Anchor,
  Store,
  ID,
  Coord,
  StopPlan,
  LockSpec,
} from '../types';
import { BREAK_ID } from '../types';
import { hhmmToMin, minToHhmm } from '../time';

export interface ScheduleCtx {
  start: Anchor;
  end: Anchor;
  window: { start: string; end: string };
  mph: number;
  defaultDwellMin: number;
  stores: Record<ID, Store>;
  mustVisitIds?: ID[];
  locks?: LockSpec[];
  distanceMatrix?: DistanceMatrix;
  maxDriveTime?: number;
  maxStops?: number;
  breakWindow?: { start: string; end: string };
  robustnessFactor?: number;
}

export interface TimelineResult {
  stops: StopPlan[];
  totalDriveMin: number;
  totalDwellMin: number;
  hotelETAmin: number;
  break?: { arriveMin: number; departMin: number };
}

export interface DistanceMatrix {
  ids: ID[];
  matrix: number[][];
  idIndex: Record<ID, number>;
}

export function buildDistanceMatrix(ctx: ScheduleCtx): DistanceMatrix {
  const ids: ID[] = [];
  const coords: Coord[] = [];
  const idIndex: Record<ID, number> = {};
  function add(id: ID, coord: Coord) {
    if (idIndex[id] != null) return;
    idIndex[id] = ids.length;
    ids.push(id);
    coords.push(coord);
  }
  add(ctx.start.id, ctx.start.coord);
  add(ctx.end.id, ctx.end.coord);
  for (const s of Object.values(ctx.stores)) {
    add(s.id, s.coord);
  }
  return { ids, matrix: buildMatrix(coords), idIndex };
}

function legMetrics(
  fromId: ID,
  from: Coord,
  toId: ID,
  to: Coord,
  mph: number,
  robustnessFactor: number,
  matrix?: DistanceMatrix,
): { dist: number; driveMin: number } {
  let dist: number;
  if (matrix) {
    const i = matrix.idIndex[fromId];
    const j = matrix.idIndex[toId];
    if (i != null && j != null) {
      dist = matrix.matrix[i][j];
    } else {
      dist = haversineMiles(from, to);
    }
  } else {
    dist = haversineMiles(from, to);
  }
  return { dist, driveMin: driveMinutes(dist, mph, robustnessFactor) };
}

export function computeTimeline(order: ID[], ctx: ScheduleCtx): TimelineResult {
  const startMin = hhmmToMin(ctx.window.start);
  const stops: StopPlan[] = [];

  let totalDriveMin = 0;
  let totalDwellMin = 0;
  let currentTime = startMin;
  let currentId: ID = ctx.start.id;
  let currentCoord: Coord = ctx.start.coord;
  const matrix = ctx.distanceMatrix;
  const breakStart = ctx.breakWindow
    ? hhmmToMin(ctx.breakWindow.start)
    : null;
  const breakEnd = ctx.breakWindow
    ? hhmmToMin(ctx.breakWindow.end)
    : null;
  const breakDur =
    breakStart != null && breakEnd != null ? breakEnd - breakStart : 0;
  let breakArrive: number | null = null;
  let breakDepart: number | null = null;
  const factor = ctx.robustnessFactor ?? 1;

  // start stop
  const [startLat, startLon] = ctx.start.coord;
  stops.push({
    id: ctx.start.id,
    name: ctx.start.name,
    type: 'start',
    arrive: minToHhmm(currentTime),
    depart: minToHhmm(currentTime),
    lat: startLat,
    lon: startLon,
  });

  for (const id of order) {
    if (id === BREAK_ID) {
      if (breakStart == null || breakEnd == null) {
        throw new Error('breakWindow required for break stop');
      }
      const arriveMin = Math.max(currentTime, breakStart);
      const departMin = arriveMin + breakDur;
      breakArrive = arriveMin;
      breakDepart = departMin;
      totalDwellMin += breakDur;
      const [lat, lon] = currentCoord;
      stops.push({
        id: BREAK_ID,
        name: 'Break',
        type: 'break',
        arrive: minToHhmm(arriveMin),
        depart: minToHhmm(departMin),
        lat,
        lon,
        dwellMin: breakDur,
      });
      currentTime = departMin;
      continue;
    }

    const store = ctx.stores[id];
    if (!store) {
      throw new Error(`Unknown store id: ${id}`);
    }

    const { dist, driveMin } = legMetrics(
      currentId,
      currentCoord,
      store.id,
      store.coord,
      ctx.mph,
      factor,
      matrix,
    );
    currentTime += driveMin;
    totalDriveMin += driveMin;

    const dwell = store.dwellMin ?? ctx.defaultDwellMin;
    const arriveMin = currentTime;
    currentTime += dwell;
    totalDwellMin += dwell;

    const [lat, lon] = store.coord;
    stops.push({
      id: store.id,
      name: store.name,
      type: 'store',
      arrive: minToHhmm(arriveMin),
      depart: minToHhmm(currentTime),
      lat,
      lon,
      dwellMin: dwell,
      legIn: {
        fromId: currentId,
        toId: store.id,
        driveMin,
        distanceMi: dist,
      },
      score: store.score,
    });

    currentId = store.id;
    currentCoord = store.coord;
  }

  // leg to end
  const { dist, driveMin } = legMetrics(
    currentId,
    currentCoord,
    ctx.end.id,
    ctx.end.coord,
    ctx.mph,
    factor,
    matrix,
  );
  currentTime += driveMin;
  totalDriveMin += driveMin;

  const [endLat, endLon] = ctx.end.coord;
  stops.push({
    id: ctx.end.id,
    name: ctx.end.name,
    type: 'end',
    arrive: minToHhmm(currentTime),
    depart: minToHhmm(currentTime),
    lat: endLat,
    lon: endLon,
    legIn: {
      fromId: currentId,
      toId: ctx.end.id,
      driveMin,
      distanceMi: dist,
    },
  });

  const result: TimelineResult = {
    stops,
    totalDriveMin,
    totalDwellMin,
    hotelETAmin: currentTime,
  };
  if (breakArrive != null && breakDepart != null) {
    result.break = { arriveMin: breakArrive, departMin: breakDepart };
  }
  return result;
}

export function isFeasible(order: ID[], ctx: ScheduleCtx): boolean {
  if (ctx.mustVisitIds) {
    for (const id of ctx.mustVisitIds) {
      if (!order.includes(id)) {
        return false;
      }
    }
  }
  if (ctx.maxStops != null) {
    const count = order.filter((id) => id !== BREAK_ID).length;
    if (count > ctx.maxStops) return false;
  }
  if (ctx.breakWindow && !order.includes(BREAK_ID)) {
    return false;
  }

  const t = computeTimeline(order, ctx);
  const endMin = hhmmToMin(ctx.window.end);
  if (t.hotelETAmin > endMin) return false;
  if (ctx.maxDriveTime != null && t.totalDriveMin > ctx.maxDriveTime) {
    return false;
  }
  if (ctx.breakWindow) {
    const bwStart = hhmmToMin(ctx.breakWindow.start);
    const bwEnd = hhmmToMin(ctx.breakWindow.end);
    const b = t.break;
    if (!b) return false;
    if (b.arriveMin < bwStart || b.departMin > bwEnd) {
      return false;
    }
  }
  return true;
}

export function slackMin(order: ID[], ctx: ScheduleCtx): number {
  const { hotelETAmin } = computeTimeline(order, ctx);
  const endMin = hhmmToMin(ctx.window.end);
  return Math.max(0, endMin - hotelETAmin);
}

/**
 * Compute the fraction of legs whose remaining slack after arrival is below
 * a given threshold.
 */
export function onTimeRisk(
  timeline: TimelineResult,
  windowEnd: string,
  thresholdMin: number,
): number {
  const endMin = hhmmToMin(windowEnd);
  let atRisk = 0;
  let legs = 0;
  for (const stop of timeline.stops.slice(1)) {
    const arrive = hhmmToMin(stop.arrive);
    const slack = endMin - arrive;
    if (slack < thresholdMin) atRisk++;
    legs++;
  }
  return legs > 0 ? atRisk / legs : 0;
}

