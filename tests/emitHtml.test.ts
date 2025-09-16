import { describe, it, expect } from 'vitest';
import { emitHtml } from '../src/io/emitHtml';
import type { DayPlan } from '../src/types';

describe('emitHtml', () => {
  it('renders itinerary using template', () => {
    const day: DayPlan = {
      dayId: 'D1',
      stops: [
        {
          id: 'S',
          name: 'Start',
          type: 'start',
          arrive: '09:00',
          depart: '09:00',
          lat: 0,
          lon: 0,
        },
        {
          id: 'A',
          name: 'Store A',
          type: 'store',
          arrive: '09:10',
          depart: '09:20',
          lat: 1,
          lon: 2,
          score: 1,
        },
        {
          id: 'E',
          name: 'End',
          type: 'end',
          arrive: '09:30',
          depart: '09:30',
          lat: 3,
          lon: 4,
        },
      ],
      excluded: [],
      metrics: {
        storeCount: 1,
        storesVisited: 1,
        visitedIds: ['A'],
        totalScore: 1,
        scorePerStore: 1,
        scorePerMin: 0,
        scorePerDriveMin: 0,
        scorePerMile: 0,
        totalDriveMin: 0,
        totalDwellMin: 0,
        slackMin: 0,
        totalDistanceMiles: 0,
        onTimeRisk: 0,
      },
    };
    const runTs = '2024-01-01T00:00:00Z';
    const runId = 'test-id';
    const runNote = 'test note';
    const html = emitHtml([day], runTs, { runId, runNote });
    expect(html).toContain('<h2>Day D1</h2>');
    expect(html).toContain('Store A');
    expect(html).toContain(runTs);
    expect(html).toContain(runId);
    expect(html).toContain(runNote);
    // one row per stop inside tbody
    const tbody = html.split('<tbody>')[1].split('</tbody>')[0];
    const rows = tbody.match(/<tr>/g) || [];
    expect(rows.length).toBe(3);
  });
});
