import { describe, it, expect } from 'vitest';
import { reoptimizeDay } from '../src/app/reoptimizeDay';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('reoptimizeDay', () => {
  it('drops completed stops and respects remaining locks', () => {
    const tripPath = join(__dirname, '../fixtures/simple-trip.json');
    const result = reoptimizeDay('00:03', [2, 0], {
      tripPath,
      dayId: 'D1',
      locks: [{ storeId: 'B', position: 'lastBeforeEnd' }],
      completedIds: ['A'],
    });
    const data = JSON.parse(result.json) as { days: { stops: { id: string; type: string }[] }[] };
    const storeIds = data.days[0].stops
      .filter((s) => s.type === 'store')
      .map((s) => s.id);
    expect(storeIds).toEqual(['C', 'B']);
    expect(data.days[0].stops[0].arrive).toBe('00:03');
  });

  it('drops infeasible stops based on remaining window', () => {
    const MILE_TO_DEG = 1 / 69;
    const trip = {
      config: { mph: 60, defaultDwellMin: 0, seed: 1 },
      days: [
        {
          dayId: 'D1',
          start: { id: 'S', name: 'start', lat: 0, lon: 0 },
          end: { id: 'E', name: 'end', lat: 10 * MILE_TO_DEG, lon: 0 },
          window: { start: '00:00', end: '00:12' },
          mustVisitIds: ['B'],
        },
      ],
      stores: [
        { id: 'A', name: 'A', lat: 2 * MILE_TO_DEG, lon: 0 },
        { id: 'B', name: 'B', lat: 5 * MILE_TO_DEG, lon: 0 },
        { id: 'C', name: 'C', lat: 8 * MILE_TO_DEG, lon: 0 },
      ],
    };
    const tmpPath = join(__dirname, 'tmp-trip.json');
    writeFileSync(tmpPath, JSON.stringify(trip));
    const result = reoptimizeDay('00:03', [2 * MILE_TO_DEG, 0], {
      tripPath: tmpPath,
      dayId: 'D1',
      locks: [{ storeId: 'B', position: 'lastBeforeEnd' }],
      completedIds: ['A'],
    });
    const data = JSON.parse(result.json) as { days: { stops: { id: string; type: string }[] }[] };
    const storeIds = data.days[0].stops
      .filter((s) => s.type === 'store')
      .map((s) => s.id);
    expect(storeIds).toEqual(['B']);
    expect(data.days[0].stops[0].arrive).toBe('00:03');
  });
});
