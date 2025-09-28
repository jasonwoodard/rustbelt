import { describe, it, expect } from 'vitest';
import {
  createPosterior,
  updatePosteriorWithObservation,
  computeRemainingPoolPosterior,
  createPosteriorPoolState,
  PosteriorConfig,
  StopPosteriorInput,
} from '../../src/io/dayOfApp/posterior';

const config: PosteriorConfig = {
  priorStrength: 4,
  baseAlpha: 1e-6,
  baseBeta: 1e-6,
  credibleZ: 1,
  defaultScore: 3.5,
};

describe('posterior math', () => {
  it('creates a posterior from a base score', () => {
    const posterior = createPosterior(4.2, config);
    expect(posterior.mean).toBeCloseTo(4.2, 5);
    expect(posterior.upper).toBeGreaterThan(posterior.mean);
    expect(posterior.lower).toBeLessThan(posterior.mean);
    expect(posterior.observationCount).toBe(0);
  });

  it('updates posterior with new observations', () => {
    const posterior = createPosterior(4, config);
    const updated = updatePosteriorWithObservation(posterior, 5, config);
    expect(updated.observationCount).toBe(1);
    expect(updated.mean).toBeGreaterThan(4);
    expect(updated.lastObservation).toBe(5);
  });

  it('computes remaining pool posterior across stops', () => {
    const poolState = createPosteriorPoolState();
    const stops: StopPosteriorInput[] = [
      { id: 'current', status: 'tovisit', score: 4.3, posterior: createPosterior(4.3, config) },
      { id: 'other', status: 'tovisit', score: 3.8, posterior: createPosterior(3.8, config) },
      { id: 'visited', status: 'visited', score: 4.5, posterior: createPosterior(4.5, config) },
    ];

    const pool = computeRemainingPoolPosterior(stops, config, poolState, 'current');
    expect(pool.count).toBe(1);
    expect(pool.mean).toBeCloseTo(3.8, 5);
    expect(pool.upper).toBeGreaterThan(pool.mean);
  });
});
