import { describe, it, expect } from 'vitest';
import { emitHtml } from '../src/io/emitHtml';
import type { DayPlan } from '../src/types';

describe('emitHtml', () => {
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

  it('renders the day-of support template by default', () => {
    const runTs = '2024-01-01T00:00:00Z';
    const runId = 'test-id';
    const runNote = 'test note';
    const html = emitHtml([day], runTs, { runId, runNote });

    expect(html).toContain('Rust Belt Bandit Planner');
    expect(html).toContain('Measured Quality Assessment (MQA)');
    expect(html).toContain('Store A');
    expect(html).toContain(`data-active-day-id="${day.dayId}`);
    expect(html).toContain('<script src="./day-of-app.js" defer></script>');

    const scriptMatch = html.match(
      /<script id="itinerary-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    const itinerary = JSON.parse(scriptMatch![1]);
    expect(itinerary.runTimestamp).toBe(runTs);
    expect(itinerary.runId).toBe(runId);
    expect(itinerary.runNote).toBe(runNote);
    expect(Array.isArray(itinerary.days)).toBe(true);
    expect(itinerary.days[0].dayId).toBe(day.dayId);
  });

  it('embeds inline assets without remote dependencies', () => {
    const html = emitHtml([day], '2024-01-01T00:00:00Z');

    expect(html).toContain('--stone-100');
    expect(html).toContain('class="container');
    expect(html).not.toMatch(/<script\s+src="https?:/);
    expect(html).not.toMatch(/<link[^>]+https?:/);
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('can render the legacy itinerary table when requested', () => {
    const runTs = '2024-01-01T00:00:00Z';
    const html = emitHtml([day], runTs, { legacyTable: true });

    expect(html).toContain('<table>');
    expect(html).toContain('<h2>Day D1</h2>');
    expect(html).toContain(runTs);
    expect(html).not.toContain('id="itinerary-data"');
  });
});
