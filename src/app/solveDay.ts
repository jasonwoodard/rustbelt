import { emitItinerary, EmitResult } from '../io/emit';
import { solveCommon } from './solveCommon';
import type { LockSpec } from '../types';
import type { ProgressFn } from '../heuristics';

export interface SolveDayOptions {
  tripPath: string;
  dayId: string;
  mph?: number;
  defaultDwellMin?: number;
  seed?: number;
  verbose?: boolean;
  locks?: LockSpec[];
  progress?: ProgressFn;
}

export function solveDay(opts: SolveDayOptions): EmitResult {
  const dayPlan = solveCommon({
    tripPath: opts.tripPath,
    dayId: opts.dayId,
    mph: opts.mph,
    defaultDwellMin: opts.defaultDwellMin,
    seed: opts.seed,
    verbose: opts.verbose,
    locks: opts.locks,
    progress: opts.progress,
  });

  return emitItinerary([dayPlan]);
}

