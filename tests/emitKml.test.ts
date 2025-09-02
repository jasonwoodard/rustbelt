import { describe, it, expect } from 'vitest';
import { solveDay } from '../src/app/solveDay';
import { emitKml } from '../src/io/emitKml';
import { DOMParser } from '@xmldom/xmldom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DayPlan } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('emitKml', () => {
  it('produces KML with placemarks for each stop', () => {
    const tripPath = join(__dirname, '../fixtures/simple-trip.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json) as { days: DayPlan[] };
    const kml = emitKml(data.days);
    const doc = new DOMParser().parseFromString(kml, 'text/xml');
    const placemarks = doc.getElementsByTagName('Placemark');
    expect(placemarks.length).toBe(data.days[0].stops.length + 1);
    expect(doc.getElementsByTagName('LineString').length).toBe(1);
  });

  it('includes extended data for each stop', () => {
    const tripPath = join(__dirname, '../fixtures/scored-trip.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json) as { days: DayPlan[] };
    const stop = data.days[0].stops[1]; // first real stop (after start)
    const kml = emitKml(data.days);
    const doc = new DOMParser().parseFromString(kml, 'text/xml');
    const placemark = doc.getElementsByTagName('Placemark')[1];
    const extended = placemark.getElementsByTagName('ExtendedData')[0];
    const getValue = (name: string): string => {
      const node = Array.from(extended.getElementsByTagName('Data')).find(
        (d) => d.getAttribute('name') === name,
      );
      expect(node, `missing ${name}`).toBeTruthy();
      return node!.getElementsByTagName('value')[0].textContent || '';
    };

    expect(getValue('id')).toBe(stop.id);
    expect(getValue('type')).toBe(stop.type);
    expect(getValue('arrive')).toBe(stop.arrive);
    expect(getValue('depart')).toBe(stop.depart);
    expect(getValue('score')).toBe(String(stop.score));
    expect(Number(getValue('driveMin'))).toBeCloseTo(stop.legIn!.driveMin);
    expect(Number(getValue('distanceMi'))).toBeCloseTo(stop.legIn!.distanceMi);
  });

  it('omits data elements for undefined fields', () => {
    const days: DayPlan[] = [
      {
        dayId: 'D1',
        stops: [
          {
            id: 'X',
            name: 'X',
            type: 'store',
            arrive: '10:00',
            depart: '10:05',
            lat: 1,
            lon: 2,
          },
        ],
        metrics: {
          storesVisited: 1,
          totalScore: 0,
          totalDriveMin: 0,
          totalDwellMin: 0,
          slackMin: 0,
          onTimeRisk: 0,
        },
      },
    ];

    const kml = emitKml(days);
    const doc = new DOMParser().parseFromString(kml, 'text/xml');
    const extended = doc
      .getElementsByTagName('Placemark')[0]
      .getElementsByTagName('ExtendedData')[0];
    const names = Array.from(extended.getElementsByTagName('Data')).map((d) =>
      d.getAttribute('name'),
    );
    expect(names).toEqual(['id', 'type', 'arrive', 'depart']);
  });
});
