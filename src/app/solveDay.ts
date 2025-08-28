import { emitItinerary, EmitResult } from '../io/emit';
import { solveCommon, augmentErrorWithReasons } from './solveCommon';
import type { LockSpec, DayPlan } from '../types';
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
  lambda?: number;
  robustnessFactor?: number;
  riskThresholdMin?: number;
}

export interface SolveDayResult extends EmitResult {
  metrics: DayPlan['metrics'];
}

export function solveDay(opts: SolveDayOptions): SolveDayResult {
  try {
    const dayPlan = solveCommon({
      tripPath: opts.tripPath,
      dayId: opts.dayId,
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
    const emit = emitItinerary([dayPlan]);
    return { ...emit, metrics: dayPlan.metrics };
  } catch (err) {
    throw augmentErrorWithReasons(err);
  }
}

