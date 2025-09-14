import { OpenLocationCode } from 'open-location-code';
import type {
  Anchor,
  Coord,
  DayConfig,
  Store,
  TripConfig,
  LockSpec,
  Weekday,
  StoreOpenHours,
} from '../types';
import type { TripInput } from '../types';
import { haversineMiles } from '../distance';
import { hhmmToMin } from '../time';

function ensureValidCoord(lat: number, lon: number): Coord {
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error(`Invalid coordinates: ${lat},${lon}`);
  }
  return [lat, lon];
}

/**
 * Parse a location string into `[lat, lon]` coordinates.
 * Supports `lat,lon`, Plus Codes, and Google Maps URLs containing `@lat,lon`.
 */
export function parseLocation(input: string): Coord {
  if (typeof input !== 'string') {
    throw new Error('Location must be a string');
  }
  const str = input.trim();

  // Direct "lat,lon" string
  const latLon = str.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)(?:.*)$/);
  if (latLon) {
    const lat = parseFloat(latLon[1]);
    const lon = parseFloat(latLon[2]);
    return ensureValidCoord(lat, lon);
  }

  // Google Maps URL with @lat,lon
  const urlMatch = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (urlMatch) {
    const lat = parseFloat(urlMatch[1]);
    const lon = parseFloat(urlMatch[2]);
    return ensureValidCoord(lat, lon);
  }

  // Plus Code
  try {
    const decoded = OpenLocationCode.decode(str);
    return ensureValidCoord(
      decoded.latitudeCenter,
      decoded.longitudeCenter,
    );
  } catch {
    /* noop */
  }

  throw new Error(
    `Unable to parse location: "${input}". Provide lat/lon, a full Plus Code, or a Maps URL with @lat,lon.`,
  );
}

type PlainObj = Record<string, unknown>;

const MISSING_COORDS_MSG = 'missing coordinates';

function parseCoord(obj: PlainObj): Coord {
  if (typeof obj.lat === 'number' && typeof obj.lon === 'number') {
    return ensureValidCoord(obj.lat, obj.lon);
  }
  if (typeof obj.location === 'string') {
    return parseLocation(obj.location);
  }
  throw new Error(MISSING_COORDS_MSG);
}

function parseAnchor(obj: PlainObj): Anchor {
  if (!obj || typeof obj.id !== 'string') {
    throw new Error('Anchor must have an id');
  }
  const id = obj.id;
  const name = typeof obj.name === 'string' ? obj.name : id;
  let coord: Coord;
  try {
    coord = parseCoord(obj);
  } catch (err) {
    if ((err as Error).message === MISSING_COORDS_MSG) {
      throw new Error(`Anchor ${id} missing coordinates`);
    }
    throw err;
  }
  return { id, name, coord };
}

function parseStore(obj: PlainObj): Store {
  if (!obj || typeof obj.id !== 'string') {
    throw new Error('Store must have an id');
  }
  const id = obj.id;
  const name = typeof obj.name === 'string' ? obj.name : id;
  let coord: Coord;
  try {
    coord = parseCoord(obj);
  } catch (err) {
    if ((err as Error).message === MISSING_COORDS_MSG) {
      throw new Error(`Store ${id} missing coordinates`);
    }
    throw err;
  }

  const store: Store = { id, name, coord };

  if (typeof obj.address === 'string') {
    store.address = obj.address;
  }

  if (obj.dwellMin !== undefined) {
    const dwell = Number(obj.dwellMin);
    if (!Number.isFinite(dwell) || dwell < 0) {
      throw new Error(`Invalid dwellMin for store ${id}`);
    }
    store.dwellMin = dwell;
  }

  if (obj.score !== undefined) {
    const score = Number(obj.score);
    if (Number.isFinite(score)) {
      store.score = score;
    }
  }

  if (obj.tags) {
    if (Array.isArray(obj.tags)) {
      store.tags = obj.tags.map(String);
    } else if (typeof obj.tags === 'string') {
      store.tags = obj.tags
        .split(/[;,|]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
  }

  if (obj.dayId !== undefined) {
    store.dayId = String(obj.dayId);
  }

  if (obj.openHours !== undefined) {
    const oh = obj.openHours as PlainObj;
    const parsed: StoreOpenHours = {};
    for (const [day, windows] of Object.entries(oh)) {
      const key = day.toLowerCase();
      if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(key)) {
        throw new Error(`Invalid day in openHours for store ${id}: ${day}`);
      }
      if (!Array.isArray(windows)) {
        throw new Error(`openHours for store ${id} day ${day} must be an array`);
      }
      parsed[key as Weekday] = windows.map((w) => {
        if (!Array.isArray(w) || w.length !== 2) {
          throw new Error(
            `openHours window for store ${id} day ${day} must be [open, close]`,
          );
          }
        const [open, close] = w.map(String);
        if (!/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close)) {
          throw new Error(
            `Invalid time format in openHours for store ${id} day ${day}`,
          );
        }
        if (hhmmToMin(close) <= hhmmToMin(open)) {
          throw new Error(
            `close must be later than open for store ${id} day ${day}`,
          );
        }
        return [open, close] as [string, string];
      });
    }
    store.openHours = parsed;
  }

  return store;
}

function parseDay(obj: PlainObj): DayConfig {
  if (!obj || typeof obj.dayId !== 'string') {
    throw new Error('Day must have dayId');
  }
  const win = obj.window as PlainObj;
  const day: DayConfig = {
    dayId: obj.dayId,
    start: parseAnchor(obj.start as PlainObj),
    end: parseAnchor(obj.end as PlainObj),
    window: { start: String(win.start), end: String(win.end) },
  };

  if (obj.mph !== undefined) {
    day.mph = Number(obj.mph);
  }
  if (obj.defaultDwellMin !== undefined) {
    day.defaultDwellMin = Number(obj.defaultDwellMin);
  }
  if (obj.mustVisitIds) {
    if (!Array.isArray(obj.mustVisitIds)) {
      throw new Error('mustVisitIds must be an array');
    }
    day.mustVisitIds = obj.mustVisitIds.map(String);
  }
  if (obj.locks) {
    day.locks = obj.locks as LockSpec[];
  }

  if (obj.maxDriveTime !== undefined) {
    day.maxDriveTime = Number(obj.maxDriveTime);
  }
  if (obj.maxStops !== undefined) {
    day.maxStops = Number(obj.maxStops);
  }
  if (obj.breakWindow) {
    const bw = obj.breakWindow as PlainObj;
    day.breakWindow = { start: String(bw.start), end: String(bw.end) };
  }
  if (obj.robustnessFactor !== undefined) {
    day.robustnessFactor = Number(obj.robustnessFactor);
  }
  if (obj.riskThresholdMin !== undefined) {
    day.riskThresholdMin = Number(obj.riskThresholdMin);
  }

  if (obj.dayOfWeek !== undefined) {
    const map: Record<string, Weekday> = {
      mon: 'mon',
      monday: 'mon',
      tue: 'tue',
      tuesday: 'tue',
      wed: 'wed',
      wednesday: 'wed',
      thu: 'thu',
      thursday: 'thu',
      fri: 'fri',
      friday: 'fri',
      sat: 'sat',
      saturday: 'sat',
      sun: 'sun',
      sunday: 'sun',
    };
    const key = String(obj.dayOfWeek).toLowerCase();
    const code = map[key];
    if (!code) {
      throw new Error(`Invalid dayOfWeek: ${obj.dayOfWeek}`);
    }
    day.dayOfWeek = code;
  }

  return day;
}

function parseTripConfig(obj?: PlainObj): TripConfig {
  const cfg: TripConfig = {};
  if (!obj) return cfg;
  if (obj.mph !== undefined) cfg.mph = Number(obj.mph);
  if (obj.defaultDwellMin !== undefined)
    cfg.defaultDwellMin = Number(obj.defaultDwellMin);
  if (obj.seed !== undefined) cfg.seed = Number(obj.seed);
  if (obj.snapDuplicateToleranceMeters !== undefined)
    cfg.snapDuplicateToleranceMeters = Number(
      obj.snapDuplicateToleranceMeters,
    );
  if (obj.robustnessFactor !== undefined)
    cfg.robustnessFactor = Number(obj.robustnessFactor);
  if (obj.riskThresholdMin !== undefined)
    cfg.riskThresholdMin = Number(obj.riskThresholdMin);
  return cfg;
}

function parseCsvStores(csv: string): PlainObj[] {
  const rows: PlainObj[] = [];
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return rows;
  const headers = lines[0].split(',').map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const obj: PlainObj = {};
    headers.forEach((h, idx) => {
      const v = values[idx];
      if (v !== undefined) obj[h] = v.trim();
    });
    rows.push(obj);
  }
  return rows;
}

/**
 * Parse trip JSON (and optional CSV list of stores) into typed structures with validation.
 */
export function parseTrip(json: PlainObj, storesCsv?: string): TripInput {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Trip JSON must be an object');
  }

  const config = parseTripConfig(json.config as PlainObj);
  const days = Array.isArray(json.days)
    ? json.days.map((d) => parseDay(d as PlainObj))
    : [];

  let storeObjs: PlainObj[] = Array.isArray(json.stores)
    ? [...(json.stores as PlainObj[])]
    : [];
  if (storesCsv) {
    storeObjs = storeObjs.concat(parseCsvStores(storesCsv));
  }
  let stores = storeObjs.map(parseStore);

  // Validate unique IDs across anchors and stores
  const seen = new Set<string>();
  const checkUnique = (id: string) => {
    if (seen.has(id)) {
      throw new Error(`Duplicate id: ${id}`);
    }
    seen.add(id);
  };
  for (const day of days) {
    checkUnique(day.start.id);
    checkUnique(day.end.id);
  }
  for (const store of stores) {
    checkUnique(store.id);
  }

  const tol = config.snapDuplicateToleranceMeters;
  if (tol && tol > 0) {
    const toleranceMiles = tol / 1609.344;
    const deduped: Store[] = [];
    for (const s of stores) {
      const match = deduped.find(
        (d) => haversineMiles(d.coord, s.coord) <= toleranceMiles,
      );
      if (match) {
        if (match.id !== s.id) {
          console.warn(
            `Dropping store ${s.id} at ${s.coord} as duplicate of ${match.id}`,
          );
        }
        continue; // skip duplicate
      }
      deduped.push(s);
    }
    stores = deduped;
  }

  const storeById = new Map<string, Store>();
  for (const s of stores) storeById.set(s.id, s);

  // Validate must-visit IDs exist
  for (const day of days) {
    if (!day.mustVisitIds) continue;
    for (const id of day.mustVisitIds) {
      const store = storeById.get(id);
      if (!store) {
        throw new Error(`Must-visit id not found: ${id}`);
      }
      if (store.dayId && store.dayId !== day.dayId) {
        throw new Error(
          `Must-visit id ${id} not available on day ${day.dayId}`,
        );
      }
    }
  }

  return { config, days, stores };
}

