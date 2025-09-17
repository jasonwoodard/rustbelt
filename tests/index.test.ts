import { describe, it, expect, vi } from 'vitest';
import { program, run } from '../src/index';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { formatTimestampToken } from '../src/time';

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

    expect(log).toHaveBeenCalledTimes(3);
    expect(String(log.mock.calls[0][0])).toContain('binding=');
    expect(String(log.mock.calls[0][0])).toContain('violations=');
    expect(String(log.mock.calls[1][0])).toContain('Excluded:');
    expect(() => JSON.parse(log.mock.calls[2][0])).not.toThrow();
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

    expect(log).toHaveBeenCalledTimes(4);
    expect(String(log.mock.calls[0][0])).toContain('binding=');
    expect(String(log.mock.calls[0][0])).toContain('violations=');
    expect(String(log.mock.calls[1][0])).toContain('Excluded:');
    expect(String(log.mock.calls[2][0])).toContain('<html');
    expect(() => JSON.parse(log.mock.calls[3][0])).not.toThrow();
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

  it('expands runId and timestamp tokens in output paths', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const tripPath = join(__dirname, '../fixtures/run-id-note-trip.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tmp = mkdtempSync(join(tmpdir(), 'rb-'));
    const base = join(tmp, 'itinerary-${runId}-${timestamp}');
    run([
      'node',
      'rustbelt',
      'solve-day',
      '--trip',
      tripPath,
      '--day',
      'D1',
      '--out',
      `${base}.json`,
      '--kml',
      `${base}.kml`,
      '--csv',
      `${base}.csv`,
      '--html',
      `${base}.html`,
    ]);
    const output = String(log.mock.calls.at(-1)?.[0]);
    const data = JSON.parse(output) as { runTimestamp: string };
    const ts = formatTimestampToken(data.runTimestamp);
    const expectedBase = join(tmp, `itinerary-RID-${ts}`);
    expect(existsSync(`${expectedBase}.json`)).toBe(true);
    expect(existsSync(`${expectedBase}.kml`)).toBe(true);
    expect(existsSync(`${expectedBase}.csv`)).toBe(true);
    expect(existsSync(`${expectedBase}.html`)).toBe(true);
    log.mockRestore();
  });
});

describe('timestamp token formatting', () => {
  const iso = '2024-05-01T01:54:00.000Z';

  const pad = (value: number, width = 2) => String(value).padStart(width, '0');

  it('formats the timestamp token using the local time zone', () => {
    const date = new Date(iso);
    const expected = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
      date.getDate(),
    )}T${pad(date.getHours())}${pad(date.getMinutes())}`;
    expect(formatTimestampToken(iso)).toBe(expected);
  });

  it('uses local getters rather than UTC getters when formatting', () => {
    const getFullYear = vi.spyOn(Date.prototype, 'getFullYear');
    const getMonth = vi.spyOn(Date.prototype, 'getMonth');
    const getDate = vi.spyOn(Date.prototype, 'getDate');
    const getHours = vi.spyOn(Date.prototype, 'getHours');
    const getMinutes = vi.spyOn(Date.prototype, 'getMinutes');

    const getUTCFullYear = vi.spyOn(Date.prototype, 'getUTCFullYear');
    const getUTCMonth = vi.spyOn(Date.prototype, 'getUTCMonth');
    const getUTCDate = vi.spyOn(Date.prototype, 'getUTCDate');
    const getUTCHours = vi.spyOn(Date.prototype, 'getUTCHours');
    const getUTCMinutes = vi.spyOn(Date.prototype, 'getUTCMinutes');

    formatTimestampToken(iso);

    expect(getFullYear).toHaveBeenCalled();
    expect(getMonth).toHaveBeenCalled();
    expect(getDate).toHaveBeenCalled();
    expect(getHours).toHaveBeenCalled();
    expect(getMinutes).toHaveBeenCalled();

    expect(getUTCFullYear).not.toHaveBeenCalled();
    expect(getUTCMonth).not.toHaveBeenCalled();
    expect(getUTCDate).not.toHaveBeenCalled();
    expect(getUTCHours).not.toHaveBeenCalled();
    expect(getUTCMinutes).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
