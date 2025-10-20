import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { solveDay } from '../src/app/solveDay';
import { hhmmToMin } from '../src/time';

interface TripJson {
  config: Record<string, unknown>;
  days: unknown[];
  stores: unknown[];
}

describe('must-visit time window conflicts', () => {
  it('reproduces the Detroit vintage crawl window squeeze', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'detroit-vintage-'));
    const tripPath = join(tmpDir, 'trip.json');

    const trip: TripJson = {
      config: {
        mph: 30,
        defaultDwellMin: 0,
      },
      days: [
        {
          dayId: 'D1',
          start: {
            id: 'START',
            name: 'Hollywood Casino Greektown',
            lat: 42.336,
            lon: -83.045,
          },
          end: {
            id: 'END',
            name: 'Hollywood Casino Greektown',
            lat: 42.336,
            lon: -83.045,
          },
          window: { start: '09:00', end: '17:00' },
          mustVisitIds: [
            'flamingo-vintage',
            'vintage-eastern-market',
            'vogue-vintage',
          ],
          dayOfWeek: 'tue',
        },
      ],
      stores: [
        {
          id: 'flamingo-vintage',
          name: 'Flamingo Vintage',
          lat: 42.347,
          lon: -83.052,
          dwellMin: 30,
          openHours: {
            tue: [
              ['11:00', '19:00'],
            ],
          },
        },
        {
          id: 'vintage-eastern-market',
          name: 'Vintage Eastern Market',
          lat: 42.349,
          lon: -83.040,
          dwellMin: 30,
          openHours: {
            tue: [
              ['10:00', '18:00'],
            ],
          },
        },
        {
          id: 'vogue-vintage',
          name: 'Vogue Vintage',
          lat: 42.355,
          lon: -83.060,
          dwellMin: 30,
          openHours: {
            tue: [
              ['11:00', '17:00'],
            ],
          },
        },
      ],
    };

    writeFileSync(tripPath, JSON.stringify(trip, null, 2));

    const intersectionStart = hhmmToMin('11:00');
    const intersectionEnd = hhmmToMin('17:00');

    let result: ReturnType<typeof solveDay> | undefined;
    let error: unknown;
    try {
      result = solveDay({ tripPath, dayId: 'D1' });
    } catch (err) {
      error = err;
    }

    if (result) {
      const payload = JSON.parse(result.json) as {
        days: { dayId: string; stops: { type: string; id: string; arrive: string; depart: string }[] }[];
      };
      const day = payload.days.find((d) => d.dayId === 'D1');
      expect(day).toBeDefined();
      const storeStops = day!.stops.filter((s) => s.type === 'store');
      expect(storeStops).toHaveLength(3);
      const ids = storeStops.map((s) => s.id).sort();
      expect(ids).toEqual(
        ['flamingo-vintage', 'vintage-eastern-market', 'vogue-vintage'].sort(),
      );
      storeStops.forEach((stop) => {
        const arriveMin = hhmmToMin(stop.arrive);
        const departMin = hhmmToMin(stop.depart);
        expect(arriveMin).toBeGreaterThanOrEqual(intersectionStart);
        expect(departMin).toBeLessThanOrEqual(intersectionEnd);
      });
      const firstArrive = storeStops[0].arrive;
      const lastDepart = storeStops[storeStops.length - 1].depart;
      console.log(`Solver scheduled store window: ${firstArrive}-${lastDepart}`);
      console.log(`Slack minutes: ${result.metrics.slackMin.toFixed(1)}`);
    } else {
      const message = (error as Error | undefined)?.message ?? 'unknown error';
      console.log('Solver scheduled store window: n/a (error)');
      console.log(`Solver error: ${message}`);
      console.log('Slack minutes: n/a');
      expect(message).toContain('must visits exceed day window');
    }
  });
});
