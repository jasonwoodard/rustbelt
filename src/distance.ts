import type { Coord } from './types';

/**
 * Compute pairwise Euclidean distances between a list of IDs.
 */
export function pairwiseDistances(
  ids: string[],
  idToCoord: Record<string, Coord>
): number[][] {
  const distances: number[][] = [];

  for (let i = 0; i < ids.length; i++) {
    const coordI = idToCoord[ids[i]];
    if (!coordI) {
      throw new Error(`Missing coordinates for id "${ids[i]}"`);
    }

    distances[i] = [];

    for (let j = 0; j < ids.length; j++) {
      const coordJ = idToCoord[ids[j]];
      if (!coordJ) {
        throw new Error(`Missing coordinates for id "${ids[j]}"`);
      }

      const dx = coordI[0] - coordJ[0];
      const dy = coordI[1] - coordJ[1];
      distances[i][j] = Math.hypot(dx, dy);
    }
  }

  return distances;
}

export function minutesAtMph(distance: number, mph: number): number {
  if (mph <= 0) {
    throw new Error(`Speed must be greater than 0 mph: ${mph}`);
  }
  return (distance / mph) * 60;
}

// Haversine formula to compute great-circle distance between two points on Earth in miles
export function haversineMiles(a: Coord, b: Coord): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1: number = toRad(a[0]);
  const lon1: number = toRad(a[1]);
  const lat2: number = toRad(b[0]);
  const lon2: number = toRad(b[1]);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const R = 3958.8; // Earth radius in miles
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Build a symmetric distance matrix in miles for the provided coordinates.
 * Only the upper triangle (j > i) is computed and mirrored to the lower triangle.
 */
export function buildMatrix(coords: Coord[]): number[][] {
  const n = coords.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = haversineMiles(coords[i], coords[j]);
      matrix[i][j] = dist;
      matrix[j][i] = dist; // mirror to lower triangle
    }
  }

  return matrix;
}

/**
 * Compute drive minutes for a given distance and speed, inflated by a
 * robustness factor to make the schedule more conservative.
 */
export function driveMinutes(
  distance: number,
  mph: number,
  robustnessFactor = 1,
): number {
  return minutesAtMph(distance, mph) * robustnessFactor;
}

