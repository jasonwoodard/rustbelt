import { describe, it, expect } from 'vitest';
import { emitCsv } from '../src/io/emitCsv';
import type { DayPlan } from '../src/types';

describe('emitCsv', () => {
  it('includes run timestamp and must_visit metadata', () => {
    const day: DayPlan = {
      dayId: 'D1',
        stops: [
          { id: 'S', name: 'Start', type: 'start', arrive: '09:00', depart: '09:00', lat: 0, lon: 0 },
          {
            id: 'A',
            name: 'Store A',
            type: 'store',
            arrive: '09:10',
            depart: '09:20',
            lat: 1,
            lon: 2,
            address: '1 A St',
            dwellMin: 10,
            legIn: { fromId: 'S', toId: 'A', driveMin: 10, distanceMi: 5 },
          },
          {
            id: 'B',
            name: 'Store B',
            type: 'store',
            arrive: '09:30',
            depart: '09:40',
            lat: 3,
            lon: 4,
            address: '2 B St',
            dwellMin: 10,
            legIn: { fromId: 'A', toId: 'B', driveMin: 10, distanceMi: 5 },
          },
        {
          id: 'E',
          name: 'End',
          type: 'end',
          arrive: '09:50',
          depart: '09:50',
          lat: 5,
          lon: 6,
          legIn: { fromId: 'B', toId: 'E', driveMin: 10, distanceMi: 5 },
        },
      ],
      metrics: {
        storeCount: 2,
        storesVisited: 2,
        visitedIds: ['A', 'B'],
        totalScore: 0,
        scorePerStore: 0,
        scorePerMin: 0,
        scorePerDriveMin: 0,
        scorePerMile: 0,
        totalDriveMin: 20,
        totalDwellMin: 20,
        slackMin: 0,
        totalDistanceMiles: 10,
        onTimeRisk: 0,
      },
    };
    const runTs = '2024-01-01T00:00:00Z';
    const runId = 'RID';
    const csv = emitCsv([day], runTs, runId, {
      mustVisitByDay: { D1: new Set(['B']) },
    });
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 store rows
    expect(lines[1]).toContain(runTs);
    expect(lines[1]).toContain(runId);
    const header = lines[0].split(',');
    expect(header[1]).toBe('run_id');
    const rowB = lines.find((l) => l.includes(',B,'))!;
    expect(rowB.split(',')[5]).toBe('true'); // must_visit column
    const rowA = lines.find((l) => l.includes(',A,'))!;
    expect(rowA).toContain('1 A St');
  });
});
