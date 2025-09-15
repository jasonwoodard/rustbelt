import type { DayPlan } from '../types';

export interface EmitOptions {
  /** include Markdown summary */
  markdown?: boolean;
  runId?: string;
  runNote?: string;
}

export interface EmitResult {
  json: string;
  runTimestamp: string;
  runId?: string;
  runNote?: string;
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

  const formatList = (values?: readonly string[]): string =>
    values && values.length ? values.map((v) => `\`${v}\``).join(', ') : '_None_';

  lines.push('## Constraint Notes', '');
  for (const d of days) {
    const m = d.metrics;
    lines.push(
      `- **${d.dayId}** – Binding: ${formatList(m.bindingConstraints)}; Violations: ${formatList(
        m.limitViolations,
      )}`,
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
  const json = JSON.stringify(
    { runTimestamp, runId: opts.runId, runNote: opts.runNote, days },
    null,
    2,
  );
  const result: EmitResult = { json, runTimestamp };
  if (opts.runId) result.runId = opts.runId;
  if (opts.runNote) result.runNote = opts.runNote;
  if (opts.markdown) {
    result.markdown = toMarkdown(days);
  }
  return result;
}

export { toMarkdown as emitMarkdown };
export function emitJson(
  days: DayPlan[],
  runTimestamp = new Date().toISOString(),
  runId?: string,
  runNote?: string,
): string {
  return JSON.stringify({ runTimestamp, runId, runNote, days }, null, 2);
}

