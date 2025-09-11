import { emitItinerary, EmitResult } from '../io/emit';
import { solveCommon, augmentErrorWithReasons } from './solveCommon';
import type { ID, LockSpec, Coord } from '../types';
import type { ProgressFn } from '../heuristics';

export interface ReoptimizeDayOptions {
  tripPath: string;
  dayId: string;
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

export function reoptimizeDay(
  now: string,
  atCoord: Coord,
  opts: ReoptimizeDayOptions,
): EmitResult {
  try {
    const dayPlan = solveCommon({
      tripPath: opts.tripPath,
      dayId: opts.dayId,
      startCoord: atCoord,
      windowStart: now,
      completedIds: opts.completedIds,
      mph: opts.mph,
      defaultDwellMin: opts.defaultDwellMin,
      seed: opts.seed,
      verbose: opts.verbose,
      locks: opts.locks,
      progress: opts.progress,
      lambda: opts.lambda,
      robustnessFactor: opts.robustnessFactor,
      riskThresholdMin: opts.riskThresholdMin,
    });

    const runTimestamp = new Date().toISOString();
    return emitItinerary([dayPlan], runTimestamp);
  } catch (err) {
    throw augmentErrorWithReasons(err);
  }
}

