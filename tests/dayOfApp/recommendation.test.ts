import { describe, it, expect } from 'vitest';
import { getRecommendation } from '../../src/io/dayOfApp/recommendation';
import {
  createPosterior,
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

describe('recommendation logic', () => {
  it('recommends leaving on bust MQA', () => {
    const posterior = createPosterior(4, config);
    const poolState = createPosteriorPoolState();
    const stops: StopPosteriorInput[] = [
      { id: 'A', status: 'tovisit', score: 4, posterior },
    ];
    const poolPosterior = computeRemainingPoolPosterior(stops, config, poolState, 'A');

    const result = getRecommendation(posterior, poolPosterior, 'Bust', 0);
    expect(result.decision).toBe('Leave');
    expect(result.reason).toBe('mqa-bust');
  });

  it('stays when current UCB exceeds remaining', () => {
    const current = createPosterior(4.5, config);
    const other = createPosterior(3.5, config);
    const poolState = createPosteriorPoolState();
    const stops: StopPosteriorInput[] = [
      { id: 'current', status: 'tovisit', score: 4.5, posterior: current },
      { id: 'other', status: 'tovisit', score: 3.5, posterior: other },
    ];
    const poolPosterior = computeRemainingPoolPosterior(stops, config, poolState, 'current');

    const result = getRecommendation(current, poolPosterior, 'Good', 4.2);
    expect(result.decision).toBe('Stay');
    expect(result.reason).toBe('ucb-favors-current');
    expect(result.diff).toBeGreaterThan(0);
  });

  it('leaves when pool outperforms current', () => {
    const current = createPosterior(3.2, config);
    const better = createPosterior(4.8, config);
    const poolState = createPosteriorPoolState();
    const stops: StopPosteriorInput[] = [
      { id: 'current', status: 'tovisit', score: 3.2, posterior: current },
      { id: 'better', status: 'tovisit', score: 4.8, posterior: better },
    ];
    const poolPosterior = computeRemainingPoolPosterior(stops, config, poolState, 'current');

    const result = getRecommendation(current, poolPosterior, 'Average', 3.5);
    expect(result.decision).toBe('Leave');
    expect(result.reason).toBe('ucb-favors-remaining');
    expect(result.diff).toBeLessThanOrEqual(0);
  });
});
