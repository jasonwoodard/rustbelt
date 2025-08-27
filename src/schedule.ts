import { minutesAtMph, haversineMiles, buildMatrix } from './distance';
import type {
  Anchor,
  Store,
  ID,
  Coord,
  StopPlan,
  LockSpec,
} from './types';
import { hhmmToMin, minToHhmm } from './time';

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
}

export interface TimelineResult {
  stops: StopPlan[];
  totalDriveMin: number;
  totalDwellMin: number;
  hotelETAmin: number;
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
  const matrix = ctx.distanceMatrix;

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

