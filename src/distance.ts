export type Coordinate = [number, number];

// Haversine formula to compute great-circle distance between two points on Earth in miles
function haversineMiles(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lat1, lon1] = a.map(toRad) as [number, number];
  const [lat2, lon2] = b.map(toRad) as [number, number];
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
export function buildMatrix(coords: Coordinate[]): number[][] {
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
