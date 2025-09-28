import { readFileSync } from 'fs';
import Mustache from 'mustache';
import type { DayPlan } from '../types';

const dayOfTemplate = readFileSync(
  new URL('./templates/day-of.mustache', import.meta.url),
  'utf8',
);
const dayOfPartials = {
  dayOfStyle: readFileSync(
    new URL('./templates/day-of-style.mustache', import.meta.url),
    'utf8',
  ),
};

const legacyTemplate = readFileSync(
  new URL('./templates/itinerary.mustache', import.meta.url),
  'utf8',
);
const legacyPartials = {
  stop: readFileSync(
    new URL('./templates/stop.mustache', import.meta.url),
    'utf8',
  ),
};

export interface EmitHtmlOptions {
  /** Override the base template */
  template?: string;
  /** Override or add partials */
  partials?: Record<string, string>;
  /** Optional run identifier */
  runId?: string;
  /** Optional run note */
  runNote?: string;
  /** Render the legacy table layout */
  legacyTable?: boolean;
  /** Preferred active day identifier */
  activeDayId?: string;
  /** Path to the day-of browser bundle relative to the HTML file */
  bundlePath?: string;
}

interface TemplateStop {
  id: string;
  arrive: string;
  depart: string;
  name: string;
  type: string;
  score?: string;
  tags?: string;
}

interface TemplateDay {
  dayId: string;
  stops: TemplateStop[];
  storeStops: TemplateStop[];
  storeCount: number;
}

interface DayOfViewModel {
  runTimestamp: string;
  runId?: string;
  runNote?: string;
  itineraryJson: string;
  days: TemplateDay[];
  activeDayId?: string;
  activeDay?: TemplateDay;
  hasMultipleDays: boolean;
  bundlePath: string;
}

interface LegacyViewModel {
  runTimestamp: string;
  runId?: string;
  runNote?: string;
  days: {
    dayId: string;
    stops: TemplateStop[];
  }[];
}

export function emitHtml(
  days: DayPlan[],
  runTimestamp = new Date().toISOString(),
  opts: EmitHtmlOptions = {},
): string {
  const itineraryJson = JSON.stringify({
    runTimestamp,
    runId: opts.runId,
    runNote: opts.runNote,
    days,
  });

  if (opts.legacyTable) {
    const legacyView: LegacyViewModel = {
      runTimestamp,
      runId: opts.runId,
      runNote: opts.runNote,
      days: days.map((d) => ({
        dayId: d.dayId,
        stops: d.stops.map((s) => ({
          id: s.id,
          arrive: s.arrive,
          depart: s.depart,
          name: s.name,
          type: s.type,
          score: s.score != null ? s.score.toFixed(1) : undefined,
          tags: s.tags?.join(', '),
        })),
      })),
    };
    const template = opts.template ?? legacyTemplate;
    const partials = opts.partials ?? legacyPartials;
    return Mustache.render(template, legacyView, partials);
  }

  const template = opts.template ?? dayOfTemplate;
  const partials = opts.partials ?? dayOfPartials;
  const bundlePath = opts.bundlePath ?? './day-of-app.js';

  const templateDays: TemplateDay[] = days.map((d) => {
    const stops = d.stops.map<TemplateStop>((s) => ({
      id: s.id,
      arrive: s.arrive,
      depart: s.depart,
      name: s.name,
      type: s.type,
      score: s.score != null ? s.score.toFixed(1) : undefined,
      tags: s.tags?.join(', '),
    }));
    const storeStops = stops.filter((s) => s.type === 'store');
    return {
      dayId: d.dayId,
      stops,
      storeStops,
      storeCount: storeStops.length,
    };
  });

  const activeDay =
    (opts.activeDayId && templateDays.find((d) => d.dayId === opts.activeDayId)) ||
    templateDays.find((d) => d.storeStops.length > 0) ||
    templateDays.find(() => true);

  const view: DayOfViewModel = {
    runTimestamp,
    runId: opts.runId,
    runNote: opts.runNote,
    itineraryJson,
    days: templateDays,
    activeDayId: activeDay?.dayId,
    activeDay,
    hasMultipleDays: templateDays.length > 1,
    bundlePath,
  };

  return Mustache.render(template, view, partials);
}

export default emitHtml;
