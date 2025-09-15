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

function formatConstraintList(values?: readonly string[]): string {
  return values && values.length ? values.join(', ') : 'none';
}

export function solveDay(opts: SolveDayOptions): SolveDayResult {
  try {
    const { dayPlan, runId, runNote } = solveCommon({
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
    const runTimestamp = new Date().toISOString();
    const emit = emitItinerary([dayPlan], runTimestamp, { runId, runNote });
    const m = dayPlan.metrics;
    const summaryParts = [
      `Day ${dayPlan.dayId}`,
      `stores=${m.storesVisited}`,
      `score=${m.totalScore.toFixed(1)}`,
      `drive=${m.totalDriveMin.toFixed(1)} min`,
      `dwell=${m.totalDwellMin.toFixed(1)} min`,
      `slack=${m.slackMin.toFixed(1)} min`,
      `binding=${formatConstraintList(m.bindingConstraints)}`,
      `violations=${formatConstraintList(m.limitViolations)}`,
    ];
    console.log(summaryParts.join(' | '));
    return { ...emit, metrics: dayPlan.metrics };
  } catch (err) {
    throw augmentErrorWithReasons(err);
  }
}

