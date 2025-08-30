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

  it('registers progress flag for solve-day', () => {
    const cmd = program.commands.find((c) => c.name() === 'solve-day');
    expect(cmd?.options.some((o) => o.long === '--progress')).toBe(true);
  });

  it('registers lambda flag for solve-day', () => {
    const cmd = program.commands.find((c) => c.name() === 'solve-day');
    expect(cmd?.options.some((o) => o.long === '--lambda')).toBe(true);
  });

  it('registers done flag for solve-day', () => {
    const cmd = program.commands.find((c) => c.name() === 'solve-day');
    const opt = cmd?.options.find((o) => o.long === '--done');
    expect(opt).toBeDefined();
    expect(opt?.description).toBe(
      'Comma-separated list of completed store IDs',
    );
  });

  it('registers html flag for solve-day', () => {
    const cmd = program.commands.find((c) => c.name() === 'solve-day');
    const opt = cmd?.options.find((o) => o.long === '--html');
    expect(opt).toBeDefined();
    expect(opt?.description).toBe(
      'Write HTML itinerary to this path (or stdout)',
    );
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

  it('emits HTML when requested', () => {
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
      '--html',
    ]);

    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).toContain('<html>');
    expect(() => JSON.parse(log.mock.calls[1][0])).not.toThrow();
    log.mockRestore();
  });

  it('prints progress snapshots when enabled', () => {
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
      '--progress',
    ]);

    const progressCalls = log.mock.calls.filter((c) =>
      String(c[0]).includes('progress'),
    );
    expect(progressCalls.length).toBeGreaterThan(0);
    log.mockRestore();
  });

  it('drops completed stops when --done is provided', () => {
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
      '--now',
      '00:00',
      '--at',
      '0,0',
      '--done',
      'A',
    ]);

    const output = log.mock.calls.at(-1)?.[0];
    const data = JSON.parse(output) as {
      days: { stops: { id: string; type: string }[] }[];
    };
    const storeIds = data.days[0].stops
      .filter((s) => s.type === 'store')
      .map((s) => s.id);
    expect(storeIds).not.toContain('A');
    log.mockRestore();
  });
});
