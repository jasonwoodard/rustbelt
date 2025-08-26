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
});
