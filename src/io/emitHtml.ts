import { readFileSync } from 'fs';
import Mustache from 'mustache';
import type { DayPlan } from '../types';

const defaultTemplate = readFileSync(
  new URL('./templates/itinerary.mustache', import.meta.url),
  'utf8',
);
const defaultPartials = {
  stop: readFileSync(new URL('./templates/stop.mustache', import.meta.url), 'utf8'),
};

export interface EmitHtmlOptions {
  /** Override the base template */
  template?: string;
  /** Override or add partials */
  partials?: Record<string, string>;
}

interface ViewModel {
  days: {
    dayId: string;
    stops: {
      arrive: string;
      depart: string;
      name: string;
      type: string;
      score?: string;
      tags?: string;
    }[];
  }[];
}

export function emitHtml(
  days: DayPlan[],
  opts: EmitHtmlOptions = {},
): string {
  const view: ViewModel = {
    days: days.map((d) => ({
      dayId: d.dayId,
      stops: d.stops.map((s) => ({
        arrive: s.arrive,
        depart: s.depart,
        name: s.name,
        type: s.type,
        score: s.score != null ? s.score.toFixed(1) : undefined,
        tags: s.tags?.join(', '),
      })),
    })),
  };
  const template = opts.template ?? defaultTemplate;
  const partials = opts.partials ?? defaultPartials;
  return Mustache.render(template, view, partials);
}

export default emitHtml;
