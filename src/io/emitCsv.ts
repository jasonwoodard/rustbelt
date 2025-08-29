import type { DayPlan, StopPlan, ID } from '../types';

export interface EmitCsvOptions {
  /** Map of day_id to set of must-visit store ids */
  mustVisitByDay?: Record<string, ReadonlySet<ID>>;
  /** Set of store ids flagged as must visits via metadata */
  storeMustVisitIds?: ReadonlySet<ID>;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function stopToRow(
  runTs: string,
  seed: number | undefined,
  dayId: string,
  stop: StopPlan,
  must: boolean,
): string {
  const leg = stop.legIn;
  const cols = [
    runTs,
    seed != null ? String(seed) : '',
    dayId,
    stop.id,
    escapeCsv(stop.name),
    must ? 'true' : 'false',
    stop.arrive,
    stop.depart,
    String(stop.lat),
    String(stop.lon),
    stop.dwellMin != null ? String(stop.dwellMin) : '',
    leg?.driveMin != null ? String(leg.driveMin) : '',
    leg?.distanceMi != null ? String(leg.distanceMi) : '',
    stop.score != null ? String(stop.score) : '',
  ];
  return cols.join(',');
}

/** Serialize itinerary store stops to CSV. */
export function emitCsv(
  days: DayPlan[],
  runTimestamp: string,
  seed: number | undefined,
  opts: EmitCsvOptions = {},
): string {
  const header = [
    'run_timestamp',
    'seed',
    'day_id',
    'store_id',
    'store_name',
    'must_visit',
    'arrive',
    'depart',
    'lat',
    'lon',
    'dwell_min',
    'drive_min',
    'distance_mi',
    'score',
  ];
  const lines = [header.join(',')];
  for (const day of days) {
    const mustVisits = opts.mustVisitByDay?.[day.dayId];
    for (const stop of day.stops) {
      if (stop.type !== 'store') continue;
      const must =
        (mustVisits && mustVisits.has(stop.id)) ||
        opts.storeMustVisitIds?.has(stop.id) ||
        false;
      lines.push(stopToRow(runTimestamp, seed, day.dayId, stop, must));
    }
  }
  return lines.join('\n');
}

export default emitCsv;
