import { Command } from 'commander';

export const program = new Command();

program
  .name('rustbelt')
  .description('CLI for ...')
  .version('0.1.0');

export function run(argv: readonly string[] = process.argv): Command {
  program.parse(argv as string[]);
  return program;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run();
}
