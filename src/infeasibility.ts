import { computeTimeline, ScheduleCtx } from './schedule';
import { hhmmToMin } from './time';
import type { ID } from './types';

export type InfeasibilitySuggestion =
  | { type: 'extendEnd'; minutes: number }
  | { type: 'dropMustVisit'; storeId: ID; minutesSaved: number }
  | { type: 'dropStore'; storeId: ID; minutesSaved: number };

/**
 * Analyze infeasible schedules and suggest relaxations ranked by time saved.
 */
export function adviseInfeasible(
  order: ID[],
  ctx: ScheduleCtx,
): InfeasibilitySuggestion[] {
  const suggestions: InfeasibilitySuggestion[] = [];
  const timeline = computeTimeline(order, ctx);
  const endMin = hhmmToMin(ctx.window.end);
  const deficit = timeline.hotelETAmin - endMin;
  if (deficit <= 0) {
    return suggestions;
  }

  suggestions.push({ type: 'extendEnd', minutes: Math.round(deficit) });

  // Must-visit chain infeasibility
  if (ctx.mustVisitIds && ctx.mustVisitIds.length > 0) {
    const chainTimeline = computeTimeline(ctx.mustVisitIds, ctx);
    if (chainTimeline.hotelETAmin > endMin) {
      for (const id of ctx.mustVisitIds) {
        const filtered = ctx.mustVisitIds.filter((m) => m !== id);
        const t = computeTimeline(filtered, ctx);
        const saved = chainTimeline.hotelETAmin - t.hotelETAmin;
        suggestions.push({
          type: 'dropMustVisit',
          storeId: id,
          minutesSaved: Math.round(saved),
        });
      }
    }
  }

  // Overfull store set analysis
  for (const id of order) {
    if (ctx.mustVisitIds && ctx.mustVisitIds.includes(id)) {
      continue;
    }
    const filtered = order.filter((s) => s !== id);
    const t = computeTimeline(filtered, ctx);
    if (t.hotelETAmin <= endMin) {
      const saved = timeline.hotelETAmin - t.hotelETAmin;
      suggestions.push({
        type: 'dropStore',
        storeId: id,
        minutesSaved: Math.round(saved),
      });
    }
  }

  suggestions.sort((a, b) => {
    const av = 'minutesSaved' in a ? a.minutesSaved : a.minutes;
    const bv = 'minutesSaved' in b ? b.minutesSaved : b.minutes;
    return bv - av;
  });

  return suggestions;
}

export default adviseInfeasible;
