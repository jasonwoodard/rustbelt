import { describe, it, expect, vi } from 'vitest';
import { program, run } from '../src/index';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('CLI', () => {
  it('configures the commander program', () => {
    expect(program.name()).toBe('rustbelt');
    expect(program.description()).toBe('CLI for ...');
    expect(program.version()).toBe('0.1.0');
    expect(program.commands.map((c) => c.name())).toContain('solve-day');
  });

  it('registers verbose flag for solve-day', () => {
    const cmd = program.commands.find((c) => c.name() === 'solve-day');
    expect(cmd?.options.some((o) => o.long === '--verbose')).toBe(true);
  });

  it('prints solution JSON by default', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const tripPath = join(__dirname, '../fixtures/simple-trip.json');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    run([
      'node',
      'rustbelt',
      'solve-day',
      '--trip',
      tripPath,
      '--day',
      'D1',
    ]);

    expect(log).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(log.mock.calls[0][0])).not.toThrow();
    log.mockRestore();
  });
});
