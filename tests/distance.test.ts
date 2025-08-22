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
  });
});
