import { describe, it, expect } from 'vitest';
import { pairwiseDistances } from '../src/distance';

describe('pairwiseDistances', () => {
  it('computes distances when all coordinates are present', () => {
    const ids = ['a', 'b'];
    const idToCoord = {
      a: [0, 0],
      b: [3, 4],
    } as const;

    const result = pairwiseDistances(ids, idToCoord);
    expect(result[0][1]).toBe(5);
    expect(result[1][0]).toBe(5);
    expect(result[0][0]).toBe(0);
  });

  it('throws when a coordinate is missing', () => {
    const ids = ['a', 'b'];
    const idToCoord = {
      a: [0, 0],
    } as const;

    expect(() => pairwiseDistances(ids, idToCoord)).toThrow(
      'Missing coordinates for id "b"'
    );

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
