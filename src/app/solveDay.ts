import { emitItinerary, EmitResult } from '../io/emit';
import { solveCommon } from './solveCommon';
import type { LockSpec } from '../types';
import type { ProgressFn } from '../heuristics';
import type { InfeasibilitySuggestion } from '../infeasibility';

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

