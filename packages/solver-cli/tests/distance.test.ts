import { describe, it, expect } from 'vitest';
import { pairwiseDistances, minutesAtMph, buildMatrix } from '../src/distance';
import type { Coord } from '../src/types';

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
  });
});

describe('minutesAtMph', () => {
  it('throws on zero mph', () => {
    expect(() => minutesAtMph(1, 0)).toThrow('greater than 0');
  });

  it('throws on negative mph', () => {
    expect(() => minutesAtMph(1, -5)).toThrow('greater than 0');
  });
});

describe('buildMatrix', () => {
  const coords: Coord[] = [
    [37.7749, -122.4194], // San Francisco
    [34.0522, -118.2437], // Los Angeles
    [40.7128, -74.006], // New York
  ];

  const matrix = buildMatrix(coords);

  it('is symmetric', () => {
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix.length; j++) {
        expect(matrix[i][j]).toBeCloseTo(matrix[j][i], 5);
      }
    }
  });

  it('has zero distance on the diagonal', () => {
    for (let i = 0; i < matrix.length; i++) {
      expect(matrix[i][i]).toBe(0);
    }
  });
});
