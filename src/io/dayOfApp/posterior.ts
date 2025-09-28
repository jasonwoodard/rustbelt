export const SCORE_MIN = 0;
export const SCORE_MAX = 5;
export const SCORE_RANGE = SCORE_MAX - SCORE_MIN;
export const EPSILON = 1e-6;

export type StopStatus = 'tovisit' | 'visited' | 'dropped';

export interface PosteriorConfig {
  priorStrength: number;
  baseAlpha: number;
  baseBeta: number;
  credibleZ: number;
  defaultScore: number;
}

export interface Posterior {
  alpha: number;
  beta: number;
  meanNormalized: number;
  mean: number;
  std: number;
  variance: number;
  lower: number;
  upper: number;
  observationCount: number;
  totalQuality: number;
  lastObservation: number | null;
  priorNormalized: number;
  pseudo: number;
}

export interface PosteriorSummary {
  alpha: number;
  beta: number;
  mean: number;
  meanNormalized: number;
  std: number;
  variance: number;
  lower: number;
  upper: number;
  observationCount: number;
  totalQuality: number;
  lastObservation: number | null;
  priorNormalized: number;
  pseudo: number;
}

export interface PosteriorPoolState {
  observedAlpha: number;
  observedBeta: number;
  observationCount: number;
  totalObservedQuality: number;
  lastObservation: number | null;
}

export interface PosteriorPoolSummary {
  alpha: number;
  beta: number;
  mean: number;
  meanNormalized: number;
  std: number;
  variance: number;
  lower: number;
  upper: number;
  count: number;
  pseudoAlpha: number;
  pseudoBeta: number;
  observationCount: number;
  totalObservedQuality: number;
}

export interface StopPosteriorInput {
  id: string | number;
  status: StopStatus;
  score?: number;
  posterior: Posterior;
}

export interface PosteriorPoolPosterior extends PosteriorPoolSummary {}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeScore(value: number | null | undefined, config: PosteriorConfig): number {
  const safeValue = typeof value === 'number' ? value : config.defaultScore;
  return clamp((safeValue - SCORE_MIN) / SCORE_RANGE, 0, 1);
}

export function denormalizeScore(normalized: number): number {
  return SCORE_MIN + clamp(normalized, 0, 1) * SCORE_RANGE;
}

export function formatScore(value: number | null | undefined): string {
  if (typeof value !== 'number') return '0.0';
  return value.toFixed(1);
}

export function recomputePosteriorStats(posterior: Posterior, config: PosteriorConfig): Posterior {
  posterior.alpha = Math.max(posterior.alpha, EPSILON);
  posterior.beta = Math.max(posterior.beta, EPSILON);
  const total = posterior.alpha + posterior.beta;
  const meanNormalized = posterior.alpha / total;
  const varianceNormalized = (posterior.alpha * posterior.beta) / ((total + 1) * total * total);
  const stdScore = Math.sqrt(Math.max(varianceNormalized, 0)) * SCORE_RANGE;
  posterior.meanNormalized = meanNormalized;
  posterior.mean = denormalizeScore(meanNormalized);
  posterior.std = stdScore;
  posterior.lower = clamp(posterior.mean - config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
  posterior.upper = clamp(posterior.mean + config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
  posterior.variance = stdScore * stdScore;
  return posterior;
}

export function createPosterior(baseScore: number | null | undefined, config: PosteriorConfig): Posterior {
  const normalized = normalizeScore(baseScore, config);
  const pseudo = config.priorStrength;
  const posterior: Posterior = {
    alpha: config.baseAlpha + normalized * pseudo,
    beta: config.baseBeta + (1 - normalized) * pseudo,
    priorNormalized: normalized,
    pseudo,
    observationCount: 0,
    totalQuality: 0,
    lastObservation: null,
    meanNormalized: 0,
    mean: 0,
    std: 0,
    variance: 0,
    lower: SCORE_MIN,
    upper: SCORE_MAX,
  };
  return recomputePosteriorStats(posterior, config);
}

export function updatePosteriorWithObservation(
  posterior: Posterior,
  mqaValue: number,
  config: PosteriorConfig,
): Posterior {
  const normalized = normalizeScore(mqaValue, config);
  posterior.alpha += normalized;
  posterior.beta += 1 - normalized;
  posterior.observationCount = (posterior.observationCount ?? 0) + 1;
  posterior.totalQuality = (posterior.totalQuality ?? 0) + mqaValue;
  posterior.lastObservation = mqaValue;
  return recomputePosteriorStats(posterior, config);
}

export function computeBetaStats(
  alpha: number,
  beta: number,
  config: PosteriorConfig,
): Omit<Posterior, 'observationCount' | 'totalQuality' | 'lastObservation' | 'priorNormalized' | 'pseudo'> {
  const safeAlpha = Math.max(alpha, EPSILON);
  const safeBeta = Math.max(beta, EPSILON);
  const total = safeAlpha + safeBeta;
  const meanNormalized = safeAlpha / total;
  const varianceNormalized = (safeAlpha * safeBeta) / ((total + 1) * total * total);
  const stdScore = Math.sqrt(Math.max(varianceNormalized, 0)) * SCORE_RANGE;
  const meanScore = denormalizeScore(meanNormalized);
  const lower = clamp(meanScore - config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
  const upper = clamp(meanScore + config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
  return {
    alpha: safeAlpha,
    beta: safeBeta,
    meanNormalized,
    mean: meanScore,
    std: stdScore,
    variance: stdScore * stdScore,
    lower,
    upper,
  };
}

export function computeRemainingPoolPosterior(
  stops: readonly StopPosteriorInput[],
  config: PosteriorConfig,
  pool: PosteriorPoolState,
  excludeId?: string | number,
): PosteriorPoolPosterior {
  let pseudoAlpha = 0;
  let pseudoBeta = 0;
  const remainingStops = stops.filter(
    (stop) => stop.status === 'tovisit' && (excludeId === undefined || String(stop.id) !== String(excludeId)),
  );

  for (const stop of remainingStops) {
    const priorNorm = stop.posterior?.priorNormalized ?? normalizeScore(stop.score, config);
    const pseudo = stop.posterior?.pseudo ?? config.priorStrength;
    pseudoAlpha += priorNorm * pseudo;
    pseudoBeta += (1 - priorNorm) * pseudo;
  }

  const alpha = config.baseAlpha + pseudoAlpha + pool.observedAlpha;
  const beta = config.baseBeta + pseudoBeta + pool.observedBeta;
  const stats = computeBetaStats(alpha, beta, config);

  return {
    ...stats,
    count: remainingStops.length,
    pseudoAlpha,
    pseudoBeta,
    observationCount: pool.observationCount,
    totalObservedQuality: pool.totalObservedQuality,
  };
}

export function serializePosterior(posterior: Posterior, config: PosteriorConfig): PosteriorSummary {
  return {
    alpha: posterior.alpha,
    beta: posterior.beta,
    mean: posterior.mean,
    meanNormalized: posterior.meanNormalized,
    std: posterior.std,
    variance: posterior.variance,
    lower: posterior.lower,
    upper: posterior.upper,
    observationCount: posterior.observationCount ?? 0,
    totalQuality: posterior.totalQuality ?? 0,
    lastObservation: posterior.lastObservation ?? null,
    priorNormalized: posterior.priorNormalized ?? normalizeScore(config.defaultScore, config),
    pseudo: posterior.pseudo ?? config.priorStrength,
  };
}

export function serializePool(poolPosterior: PosteriorPoolPosterior): PosteriorPoolSummary {
  return {
    alpha: poolPosterior.alpha,
    beta: poolPosterior.beta,
    mean: poolPosterior.mean,
    meanNormalized: poolPosterior.meanNormalized,
    std: poolPosterior.std,
    variance: poolPosterior.variance,
    lower: poolPosterior.lower,
    upper: poolPosterior.upper,
    count: poolPosterior.count,
    pseudoAlpha: poolPosterior.pseudoAlpha,
    pseudoBeta: poolPosterior.pseudoBeta,
    observationCount: poolPosterior.observationCount,
    totalObservedQuality: poolPosterior.totalObservedQuality,
  };
}

export function createPosteriorPoolState(): PosteriorPoolState {
  return {
    observedAlpha: 0,
    observedBeta: 0,
    observationCount: 0,
    totalObservedQuality: 0,
    lastObservation: null,
  };
}

export function updatePoolObservation(
  pool: PosteriorPoolState,
  mqaValue: number,
  config: PosteriorConfig,
): void {
  const normalized = normalizeScore(mqaValue, config);
  pool.observedAlpha += normalized;
  pool.observedBeta += 1 - normalized;
  pool.observationCount += 1;
  pool.totalObservedQuality += mqaValue;
  pool.lastObservation = mqaValue;
}
