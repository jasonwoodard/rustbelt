import { describe, expect, it } from 'vitest';
import { minutesAtMph } from '../src/distance';

describe('minutesAtMph', () => {
  it('throws on zero mph', () => {
    expect(() => minutesAtMph(1, 0)).toThrow('greater than 0');
  });

  it('throws on negative mph', () => {
    expect(() => minutesAtMph(1, -5)).toThrow('greater than 0');
  });

describe('buildMatrix', () => {
  const coords: Coordinate[] = [
    [37.7749, -122.4194], // San Francisco
    [34.0522, -118.2437], // Los Angeles
    [40.7128, -74.006],   // New York
  ];

  const matrix = buildMatrix(coords);

  it('computes distances only once and mirrors them', () => {
    expect(matrix[0][1]).toBeCloseTo(matrix[1][0], 5);
    expect(matrix[0][2]).toBeCloseTo(matrix[2][0], 5);
    expect(matrix[1][2]).toBeCloseTo(matrix[2][1], 5);
  });

  it('has zero distance on the diagonal', () => {
    for (let i = 0; i < coords.length; i++) {
      expect(matrix[i][i]).toBe(0);
    }
  });
});
