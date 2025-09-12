import { describe, it, expect } from 'vitest';
import { parseTrip } from '../src/io/parse';

// Regression test to ensure store duplicates by location are removed

describe('parseTrip', () => {
  it('dedupes stores within snapDuplicateToleranceMeters', () => {
    const input = {
      config: { snapDuplicateToleranceMeters: 10 },
      stores: [
        { id: 'a', lat: 0, lon: 0 },
        { id: 'b', lat: 0, lon: 0 },
      ],
    };
    const { stores } = parseTrip(input);
    expect(stores).toHaveLength(1);
    expect(stores[0].id).toBe('a');
  });

  it('parses store address', () => {
    const input = { stores: [{ id: 'a', lat: 0, lon: 0, address: '123 Main St' }] };
    const { stores } = parseTrip(input);
    expect(stores[0].address).toBe('123 Main St');
  });
});
