import { Command } from 'commander';
import { solveDay } from './app/solveDay';

export const program = new Command();

program
  .name('rustbelt')
  .description('CLI for ...')
  .version('0.1.0');

program
  .command('solve-day')
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
  .action((opts) => {
    const result = solveDay({
      tripPath: opts.trip,
      dayId: opts.day,
      mph: opts.mph,
      defaultDwellMin: opts.defaultDwell,
      seed: opts.seed,
      verbose: opts.verbose,
    });
    console.log(result.json);
  });

export function run(argv: readonly string[] = process.argv): Command {
  program.parse(argv as string[]);
  return program;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run();
}
