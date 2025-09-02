import type { DayPlan } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Serialize itinerary stops to KML. */
export function emitKml(days: DayPlan[]): string {
  const placemarks: string[] = [];
  const routeCoords: string[] = [];
  for (const day of days) {
    for (const stop of day.stops) {
      const details: [string, string | number | undefined][] = [
        ['id', stop.id],
        ['type', stop.type],
        ['arrive', stop.arrive],
        ['depart', stop.depart],
        ['score', stop.score],
        ['driveMin', stop.legIn?.driveMin],
        ['distanceMi', stop.legIn?.distanceMi],
        ['dwellMin', stop.dwellMin],
        ['tags', stop.tags?.join(';')],
      ];
      const data = details
        .filter(([, value]) => value !== undefined)
        .map(
          ([name, value]) =>
            `<Data name="${name}"><value>${escapeXml(String(value))}</value></Data>`,
        )
        .join('');
      const extended = data ? `<ExtendedData>${data}</ExtendedData>` : '';
      placemarks.push(
        `<Placemark><name>${escapeXml(stop.name)}</name>${extended}<Point><coordinates>${stop.lon},${stop.lat},0</coordinates></Point></Placemark>`,
      );
      routeCoords.push(`${stop.lon},${stop.lat},0`);
    }
  }
  const route = `<Placemark><name>Route</name><LineString><coordinates>${routeCoords.join(' ')}</coordinates></LineString></Placemark>`;
  const doc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    ...placemarks,
    route,
    '</Document>',
    '</kml>',
  ];
  return doc.join('\n');
}

export default emitKml;
