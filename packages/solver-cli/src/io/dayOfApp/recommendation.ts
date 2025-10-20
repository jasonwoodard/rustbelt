import type { Posterior, PosteriorPoolPosterior } from './posterior';

export interface RecommendationMeta {
  decision: 'Stay' | 'Leave';
  reason: string;
  diff: number | null;
  zScore: number | null;
  currentUcb: number | null;
  remainingUcb: number | null;
  observationCount: number;
}

export function getRecommendation(
  currentPosterior: Posterior | null | undefined,
  poolPosterior: PosteriorPoolPosterior | null | undefined,
  mqaKey: string,
  mqaValue: number | null | undefined,
): RecommendationMeta {
  const fallbackCurrentUcb = typeof mqaValue === 'number' ? mqaValue : null;
  const derivedCurrentUcb =
    currentPosterior && typeof currentPosterior.upper === 'number' ? currentPosterior.upper : null;
  const currentUcb = derivedCurrentUcb ?? fallbackCurrentUcb;
  const derivedRemainingUcb =
    poolPosterior && typeof poolPosterior.upper === 'number' ? poolPosterior.upper : null;
  const fallbackRemainingUcb =
    poolPosterior && typeof poolPosterior.mean === 'number' ? poolPosterior.mean : null;
  const remainingUcb = derivedRemainingUcb ?? fallbackRemainingUcb;
  const observationCount = currentPosterior?.observationCount ?? 0;

  if (mqaKey === 'Bust') {
    const diff =
      currentUcb != null && remainingUcb != null ? currentUcb - remainingUcb : currentUcb ?? null;
    return {
      decision: 'Leave',
      reason: 'mqa-bust',
      diff,
      zScore: null,
      currentUcb,
      remainingUcb,
      observationCount,
    };
  }

  if (!currentPosterior || currentUcb == null) {
    return {
      decision: 'Leave',
      reason: 'no-current-posterior',
      diff: null,
      zScore: null,
      currentUcb,
      remainingUcb,
      observationCount,
    };
  }

  if (!poolPosterior || poolPosterior.count === 0 || remainingUcb == null) {
    return {
      decision: 'Stay',
      reason: 'no-remaining-stops',
      diff: currentUcb,
      zScore: null,
      currentUcb,
      remainingUcb,
      observationCount,
    };
  }

  const diff = currentUcb - remainingUcb;
  const combinedStd = Math.sqrt(
    currentPosterior.std * currentPosterior.std + poolPosterior.std * poolPosterior.std,
  );
  const zScore =
    combinedStd > 0
      ? diff / combinedStd
      : diff >= 0
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

  if (diff > 0) {
    return {
      decision: 'Stay',
      reason: 'ucb-favors-current',
      diff,
      zScore,
      currentUcb,
      remainingUcb,
      observationCount,
    };
  }

  return {
    decision: 'Leave',
    reason: diff === 0 ? 'ucb-tie' : 'ucb-favors-remaining',
    diff,
    zScore,
    currentUcb,
    remainingUcb,
    observationCount,
  };
}
