import { describe, it, expect } from 'vitest';
import { solveDay } from '../src/app/solveDay';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseTrip } from '../src/io/parse';
import { computeTimeline } from '../src/schedule';
import type { Store } from '../src/types';
import { hhmmToMin } from '../src/time';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('solveDay', () => {
  it('produces a day plan for a simple trip', () => {
    const tripPath = join(__dirname, '../fixtures/simple-trip.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json);
    const ids = data.days[0].stops.map((s: { id: string }) => s.id);
    expect(ids).toEqual(['S', 'A', 'B', 'C', 'E']);
    expect(data.days[0].metrics.storesVisited).toBe(3);
    expect(data.days[0].metrics.totalScore).toBe(0);
  });

  it('produces stable itinerary output (FR-31)', () => {
    const tripPath = join(__dirname, '../fixtures/simple-trip.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    expect(JSON.parse(result.json)).toMatchSnapshot();
  });

  it('respects store scores when lambda=1', () => {
    const tripPath = join(__dirname, '../fixtures/scored-trip.json');
    const resCount = solveDay({ tripPath, dayId: 'D1' });
    const dataCount = JSON.parse(resCount.json);
    const storesCount = dataCount.days[0].stops
      .filter((s: { type: string }) => s.type === 'store')
      .map((s: { id: string }) => s.id);
    expect(storesCount).toEqual(['A']);

    const resScore = solveDay({ tripPath, dayId: 'D1', lambda: 1 });
    const dataScore = JSON.parse(resScore.json);
    const storesScore = dataScore.days[0].stops
      .filter((s: { type: string }) => s.type === 'store')
      .map((s: { id: string }) => s.id);
    expect(storesScore).toEqual(['B']);
    expect(dataScore.days[0].metrics.totalScore).toBe(100);
  });

  it('throws if must visits exceed day window', () => {
    const tripPath = join(
      __dirname,
      '../fixtures/infeasible-must-visit.json',
    );
    const raw = readFileSync(tripPath, 'utf8');
    const trip = parseTrip(JSON.parse(raw));
    const day = trip.days[0];
    const stores: Record<string, Store> = {};
    for (const s of trip.stores) {
      stores[s.id] = s;
    }
    const ctx = {
      start: day.start,
      end: day.end,
      window: day.window,
      mph: day.mph ?? trip.config.mph ?? 30,
      defaultDwellMin:
        day.defaultDwellMin ?? trip.config.defaultDwellMin ?? 0,
      stores,
    };
    const { hotelETAmin } = computeTimeline(day.mustVisitIds!, ctx);
    const endMin = hhmmToMin(day.window.end);
    const deficit = Math.round(hotelETAmin - endMin);
    try {
      solveDay({ tripPath, dayId: 'D1' });
      throw new Error('expected solveDay to throw');
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
