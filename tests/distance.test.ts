import { describe, expect, it } from 'vitest';
import { minutesAtMph } from '../src/distance';

describe('minutesAtMph', () => {
  it('throws on zero mph', () => {
    expect(() => minutesAtMph(1, 0)).toThrow('greater than 0');
  });

  it('throws on negative mph', () => {
    expect(() => minutesAtMph(1, -5)).toThrow('greater than 0');
  });
});
