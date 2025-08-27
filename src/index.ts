import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { solveDay } from './app/solveDay';
import { reoptimizeDay } from './app/reoptimizeDay';
import { emitKml } from './io/emitKml';
import type { DayPlan } from './types';

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
  .option('--verbose', 'Print heuristic steps')
  .option('--progress', 'Print heuristic progress')
  .option('--now <HH:mm>', 'Reoptimize from this time')
  .option('--at <lat,lon>', 'Current location')
  .option('--done <ids>', 'Comma-separated list of completed store IDs')
  .option('--out <file>', 'Write itinerary JSON to this path (overwrite)')
  .option('--kml [file]', 'Write KML to this path (or stdout)')
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
          verbose: opts.verbose,
          completedIds,
          progress: opts.progress
            ? (phase, order, metrics) =>
                console.log(
                  `progress ${phase}: stops=${order.length} slack=${metrics.slackMin.toFixed(
                    1,
                  )} drive=${metrics.totalDriveMin.toFixed(1)}`,
                )
            : undefined,
        },
      );
    } else {
      result = solveDay({
        tripPath: opts.trip,
        dayId: opts.day,
        mph: opts.mph,
        defaultDwellMin: opts.defaultDwell,
        seed: opts.seed,
        verbose: opts.verbose,
        progress: opts.progress
          ? (phase, order, metrics) =>
              console.log(
                `progress ${phase}: stops=${order.length} slack=${metrics.slackMin.toFixed(
                  1,
                )} drive=${metrics.totalDriveMin.toFixed(1)}`,
              )
          : undefined,
      });
    }
  
    if (opts.out) {
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, result.json, 'utf8');
      console.log(`Wrote ${opts.out}`);
    }

    if (opts.kml !== undefined) {
      const data = JSON.parse(result.json) as { days: DayPlan[] };
      const kml = emitKml(data.days);
      if (typeof opts.kml === 'string') {
        mkdirSync(dirname(opts.kml), { recursive: true });
        writeFileSync(opts.kml, kml, 'utf8');
        console.log(`Wrote ${opts.kml}`);
      } else {
        console.log(kml);
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
