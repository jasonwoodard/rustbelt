export type ID = string;

export const BREAK_ID: ID = '__break__';

export type Coord = readonly [number, number];

export interface Anchor {
  id: ID;
  name: string;
  coord: Coord;
}

export interface Store {
  id: ID;
  name: string;
  coord: Coord;
  dwellMin?: number;
  score?: number; // v0.3
  tags?: string[];
  dayId?: string; // when using a global list
}

export type LockSpec =
  | { storeId: ID; position: "firstAfterStart" | "lastBeforeEnd" }
  | { storeId: ID; index: number }
  | { storeId: ID; afterStoreId: ID };

export interface DayConfig {
  dayId: string;
  start: Anchor;
  end: Anchor;
  window: { start: string; end: string }; // "HH:mm"
  mph?: number;
  defaultDwellMin?: number;
  mustVisitIds?: ID[];
  locks?: LockSpec[]; // v0.2+
  maxDriveTime?: number;
  maxStops?: number;
  breakWindow?: { start: string; end: string };
  robustnessFactor?: number;
  riskThresholdMin?: number;
}

export interface TripConfig {
  mph?: number;
  defaultDwellMin?: number;
  seed?: number;
  snapDuplicateToleranceMeters?: number;
  robustnessFactor?: number;
  riskThresholdMin?: number;
}

export interface Leg {
  fromId: ID;
  toId: ID;
  driveMin: number;
  distanceMi: number;
}

export interface StopPlan {
  id: ID;
  name: string;
  type: "start" | "store" | "break" | "end";
  arrive: string;
  depart: string;
  lat: number;
  lon: number;
  dwellMin?: number;
  legIn?: Leg;
  score?: number;
  tags?: string[];
}

export interface DayPlan {
  dayId: string;
  stops: StopPlan[];
  metrics: {
    storesVisited: number;
    totalScore: number;
    totalDriveMin: number;
    totalDwellMin: number;
    slackMin: number;
    onTimeRisk: number;
    limitViolations?: string[];
    bindingConstraints?: string[];
  };
}


export interface TripInput {
  config: TripConfig;
  days: DayConfig[];
  stores: Store[];
}

