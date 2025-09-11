import type { DayPlan } from '../types';

export interface EmitOptions {
  /** include Markdown summary */
  markdown?: boolean;
}

export interface EmitResult {
  json: string;
  runTimestamp: string;
  markdown?: string;
}

function toMarkdown(days: DayPlan[]): string {
  const lines: string[] = [
    '# Itinerary Summary',
    '',
    '| Day | Stores Visited | Total Score | Total Drive (min) | Total Dwell (min) | Slack (min) |',
    '| --- | ---------------:| -----------:| -----------------:| -----------------:| ----------:|',
  ];
  for (const d of days) {
    const m = d.metrics;
    lines.push(
      `| ${d.dayId} | ${m.storesVisited} | ${m.totalScore.toFixed(1)} | ${m.totalDriveMin.toFixed(
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
  runTimestamp = new Date().toISOString(),
  opts: EmitOptions = {},
): EmitResult {
  const json = JSON.stringify({ runTimestamp, days }, null, 2);
  const result: EmitResult = { json, runTimestamp };
  if (opts.markdown) {
    result.markdown = toMarkdown(days);
  }
  return result;
}

export { toMarkdown as emitMarkdown };
export function emitJson(
  days: DayPlan[],
  runTimestamp = new Date().toISOString(),
): string {
  return JSON.stringify({ runTimestamp, days }, null, 2);
}

