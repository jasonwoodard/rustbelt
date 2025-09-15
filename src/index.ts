import { Command } from 'commander';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { solveDay } from './app/solveDay';
import { reoptimizeDay } from './app/reoptimizeDay';
import { emitKml } from './io/emitKml';
import { emitCsv } from './io/emitCsv';
import { emitHtml } from './io/emitHtml';
import { parseTrip } from './io/parse';
import type { DayPlan, ID } from './types';
import type { ProgressFn } from './heuristics';
import { formatTimestampToken } from './time';

function buildProgressLogger(verbose: boolean): ProgressFn {
  return (phase, order, metrics) => {
    const detail = verbose ? ` order=${order.join(',')}` : '';
    console.log(
      `progress ${phase}: stops=${order.length} slack=${metrics.slackMin.toFixed(
        1,
      )} drive=${metrics.totalDriveMin.toFixed(1)} eta=${metrics.hotelETAmin.toFixed(1)}${detail}`,
    );
  };
}

export const program = new Command();

program
  .name('rustbelt')
  .description('CLI for ...')
  .version('0.1.0')
  .showHelpAfterError();

program
  .command('solve-day',  { isDefault: true })
  .requiredOption('--trip <file>', 'Path to trip JSON file')
  .requiredOption('--day <id>', 'Day id to solve')
  .option('--mph <mph>', 'Average speed in mph', parseFloat)
  .option(
    '--default-dwell <min>',
    'Default dwell minutes',
    parseFloat,
  )
  .option('--seed <seed>', 'Random seed', parseFloat)
  .option('--lambda <lambda>', 'Score weighting (0=count,1=score)', parseFloat)
  .option('--verbose', 'Print heuristic steps')
  .option('--progress', 'Print heuristic progress')
  .option('--now <HH:mm>', 'Reoptimize from this time')
  .option('--at <lat,lon>', 'Current location')
  .option('--done <ids>', 'Comma-separated list of completed store IDs')
  .option('--out <file>', 'Write itinerary JSON to this path (overwrite)')
  .option('--kml [file]', 'Write KML to this path (or stdout)')
  .option('--html [file]', 'Write HTML itinerary to this path (or stdout)')
  .option('--csv <file>', 'Write store stops CSV to this path')
  .option(
    '--robustness <factor>',
    'Multiply travel times by this factor',
    parseFloat,
  )
  .option(
    '--risk-threshold <min>',
    'Slack threshold minutes for on-time risk',
    parseFloat,
  )
  .action((opts) => {
    let result;
    if (opts.now && opts.at) {
      const [lat, lon] = opts.at.split(',').map(Number);
      const completedIds = opts.done
        ? String(opts.done)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      result = reoptimizeDay(
        opts.now,
        [lat, lon],
        {
          tripPath: opts.trip,
          dayId: opts.day,
          mph: opts.mph,
          defaultDwellMin: opts.defaultDwell,
          seed: opts.seed,
          lambda: opts.lambda,
          verbose: opts.verbose,
          completedIds,
          progress: opts.progress
            ? buildProgressLogger(Boolean(opts.verbose))
            : undefined,
          robustnessFactor: opts.robustness,
          riskThresholdMin: opts['risk-threshold'],
        },
      );
    } else {
      result = solveDay({
        tripPath: opts.trip,
        dayId: opts.day,
        mph: opts.mph,
        defaultDwellMin: opts.defaultDwell,
        seed: opts.seed,
        lambda: opts.lambda,
        verbose: opts.verbose,
        progress: opts.progress
          ? buildProgressLogger(Boolean(opts.verbose))
          : undefined,
        robustnessFactor: opts.robustness,
        riskThresholdMin: opts['risk-threshold'],
      });
    }

    const data = JSON.parse(result.json) as {
      runTimestamp: string;
      days: DayPlan[];
    };
    const runTs = result.runTimestamp;
    const runId = result.runId;
    const tsToken = formatTimestampToken(runTs);
    const tokenize = (s: string): string =>
      s.replace(/\$\{(runId|timestamp)\}/g, (_, k) =>
        k === 'runId' ? runId ?? '' : tsToken,
      );

    if (opts.out) {
      const outPath = tokenize(opts.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, result.json, 'utf8');
      console.log(`Wrote ${outPath}`);
    }

    if (opts.csv) {
      const rawTrip = readFileSync(opts.trip, 'utf8');
      const trip = parseTrip(JSON.parse(rawTrip));
      const mustVisitByDay: Record<string, ReadonlySet<ID>> = {};
      for (const d of trip.days) {
        if (d.mustVisitIds) {
          mustVisitByDay[d.dayId] = new Set(d.mustVisitIds);
        }
      }
      const storeMustVisitIds = new Set(
        trip.stores
          .filter((s) => (s.tags ?? []).some((t) => /must[-_]?visit/i.test(t)))
          .map((s) => s.id),
      );
      const csv = emitCsv(data.days, runTs, opts.seed ?? trip.config.seed, {
        mustVisitByDay,
        storeMustVisitIds,
      });
      const csvPath = tokenize(opts.csv);
      mkdirSync(dirname(csvPath), { recursive: true });
      writeFileSync(csvPath, csv, 'utf8');
      console.log(`Wrote ${csvPath}`);
    }

    if (opts.kml !== undefined) {
      const kml = emitKml(data.days, runTs);
      if (typeof opts.kml === 'string') {
        const kmlPath = tokenize(opts.kml);
        mkdirSync(dirname(kmlPath), { recursive: true });
        writeFileSync(kmlPath, kml, 'utf8');
        console.log(`Wrote ${kmlPath}`);
      } else {
        console.log(kml);
      }
    }

    if (opts.html !== undefined) {
      const html = emitHtml(data.days, runTs);
      if (typeof opts.html === 'string') {
        const htmlPath = tokenize(opts.html);
        mkdirSync(dirname(htmlPath), { recursive: true });
        writeFileSync(htmlPath, html, 'utf8');
        console.log(`Wrote ${htmlPath}`);
      } else {
        console.log(html);
      }
    }

    console.log(result.json);
  });
  
export function run(argv: readonly string[] = process.argv): Command {
  program.parse(argv as string[]);
  return program;
}

import { fileURLToPath } from 'node:url';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
