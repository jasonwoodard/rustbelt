export type ID = string;

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
}

export interface TripConfig {
  mph?: number;
  defaultDwellMin?: number;
  seed?: number;
  snapDuplicateToleranceMeters?: number;
}

export interface Leg {
  fromId: ID;
  toId: ID;
  driveMin: number;
  distanceMi: number;
}

export interface StopPlan {
  id: ID;
  type: "start" | "store" | "end";
  arrive: string;
  depart: string;
  dwellMin?: number;
  legIn?: Leg;
}

export interface DayPlan {
  dayId: string;
  stops: StopPlan[];
  metrics: {
    storesVisited: number;
    totalDriveMin: number;
    totalDwellMin: number;
    slackMin: number;
  };
}


export interface TripInput {
  config: TripConfig;
  days: DayConfig[];
  stores: Store[];
}

