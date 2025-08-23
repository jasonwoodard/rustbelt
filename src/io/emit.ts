import type { DayPlan } from '../types';

export interface EmitOptions {
  /** include Markdown summary */
  markdown?: boolean;
}

export interface EmitResult {
  json: string;
  markdown?: string;
}

function toMarkdown(days: DayPlan[]): string {
  const lines: string[] = [
    '# Itinerary Summary',
    '',
    '| Day | Stores Visited | Total Drive (min) | Total Dwell (min) | Slack (min) |',
    '| --- | ---------------:| -----------------:| -----------------:| ----------:|',
  ];
  for (const d of days) {
    const m = d.metrics;
    lines.push(
      `| ${d.dayId} | ${m.storesVisited} | ${m.totalDriveMin.toFixed(
        1,
      )} | ${m.totalDwellMin.toFixed(1)} | ${m.slackMin.toFixed(1)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Serialize per-day itineraries to JSON and optional Markdown summary. */
export function emitItinerary(
  days: DayPlan[],
  opts: EmitOptions = {},
): EmitResult {
  const json = JSON.stringify({ days }, null, 2);
  const result: EmitResult = { json };
  if (opts.markdown) {
    result.markdown = toMarkdown(days);
  }
  return result;
}

export { toMarkdown as emitMarkdown };
export function emitJson(days: DayPlan[]): string {
  return JSON.stringify({ days }, null, 2);
}

