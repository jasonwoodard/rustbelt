import { emitItinerary, EmitResult } from '../io/emit';
import { solveCommon } from './solveCommon';
import type { ID, LockSpec, Coord } from '../types';
import type { ProgressFn } from '../heuristics';
import type { InfeasibilitySuggestion } from '../infeasibility';

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
    });

    return emitItinerary([dayPlan]);
  } catch (err) {
    const e = err as Error & {
      suggestions?: InfeasibilitySuggestion[];
    };
    if (e.suggestions && !e.message.includes('reasons:')) {
      const reasons = Array.from(
        new Set(e.suggestions.map((s) => s.reason)),
      ).join('; ');
      const newErr = new Error(`${e.message}; reasons: ${reasons}`);
      (newErr as Error & { suggestions?: unknown[] }).suggestions =
        e.suggestions;
      throw newErr;
    }
    throw e;
  }
}

