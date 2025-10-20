import { describe, it, expect } from 'vitest';
import { reoptimizeDay } from '../src/app/reoptimizeDay';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { computeTimeline } from '../src/schedule';
import type { Store } from '../src/types';
import { hhmmToMin } from '../src/time';

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

  it('throws if must visits exceed day window', () => {
    const MILE_TO_DEG = 1 / 69;
    const trip = {
      config: { mph: 60, defaultDwellMin: 0, seed: 1 },
      days: [
        {
          dayId: 'D1',
          start: {
            id: 'S',
            name: 'start',
            lat: 0,
            lon: 0,
            coord: [0, 0],
          },
          end: {
            id: 'E',
            name: 'end',
            lat: 0,
            lon: 0,
            coord: [0, 0],
          },
          window: { start: '00:00', end: '00:11' },
          mustVisitIds: ['A', 'B'],
        },
      ],
      stores: [
        {
          id: 'A',
          name: 'A',
          lat: 3 * MILE_TO_DEG,
          lon: 4 * MILE_TO_DEG,
          coord: [3 * MILE_TO_DEG, 4 * MILE_TO_DEG],
        },
        {
          id: 'B',
          name: 'B',
          lat: -3 * MILE_TO_DEG,
          lon: 4 * MILE_TO_DEG,
          coord: [-3 * MILE_TO_DEG, 4 * MILE_TO_DEG],
        },
      ],
    };
    const tmpPath = join(__dirname, 'tmp-infeasible-trip.json');
    writeFileSync(tmpPath, JSON.stringify(trip));
    const day = trip.days[0];
    const stores: Record<string, Store> = {};
    for (const s of trip.stores) {
      stores[s.id] = s;
    }
    const ctx = {
      start: day.start,
      end: day.end,
      window: day.window,
      mph: 60,
      defaultDwellMin: 0,
      stores,
    };
    const { hotelETAmin } = computeTimeline(day.mustVisitIds!, ctx);
    const endMin = hhmmToMin(day.window.end);
    const deficit = Math.round(hotelETAmin - endMin);
    try {
      reoptimizeDay('00:00', [0, 0], { tripPath: tmpPath, dayId: 'D1' });
      throw new Error('expected reoptimizeDay to throw');
    } catch (err) {
      const e = err as Error;
      expect(e.message).toContain(
        `must visits exceed day window by ${deficit} min`,
      );
      expect(e.message).toContain('Must-visit chain exceeds window');
      const match = e.message.match(/suggestions: (.*)$/);
      expect(match).not.toBeNull();
      const suggestions = JSON.parse(match![1]);
      const types = suggestions.map((s: { type: string }) => s.type);
      expect(types).toContain('extendEnd');
      expect(types).toContain('dropMustVisit');
      expect(
        suggestions.every(
          (s: { reason?: string }) => typeof s.reason === 'string',
        ),
      ).toBe(true);
    }
  });
});
