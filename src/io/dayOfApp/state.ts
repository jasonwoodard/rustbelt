import type { RecommendationMeta } from './recommendation';
import {
  createPosterior,
  createPosteriorPoolState,
  formatScore,
  Posterior,
  PosteriorConfig,
  PosteriorPoolState,
  PosteriorPoolSummary,
  PosteriorSummary,
} from './posterior';

export interface RawStop {
  id: string;
  name: string;
  type: string;
  arrive: string;
  depart: string;
  score?: number;
  lat?: number;
  lon?: number;
  address?: string;
  [key: string]: unknown;
}

export interface RawDay {
  dayId: string;
  stops: RawStop[];
}

export interface RawItinerary {
  runTimestamp?: string;
  runId?: string;
  runNote?: string;
  days?: RawDay[];
}

export interface StopLogEntry {
  name: string;
  mapsUrl: string | null;
  mqa: string;
  mqaValue: number | null;
  decision: string;
  decisionReason: string;
  diff: number | null;
  zScore: number | null;
  currentUcb: number | null;
  remainingUcb: number | null;
  observationCount: number | null;
  posterior: PosteriorSummary;
  pool: PosteriorPoolSummary | null;
  timestamp: string;
}

export interface StopState extends RawStop {
  status: 'tovisit' | 'visited' | 'dropped';
  posterior: Posterior;
  posteriorSummary?: PosteriorSummary & {
    diff: number | null;
    zScore: number | null;
    currentUcb: number | null;
    remainingUcb: number | null;
  };
  mapsUrl: string | null;
  mqa?: string;
  mqaValue?: number;
  decision?: string;
  decisionReason?: string;
}

export interface PendingDrop {
  stopId?: string | number;
  id?: string | number;
}

export interface RecommendationSnapshot {
  recommendation: string;
  meta: RecommendationMeta;
  currentPosterior: PosteriorSummary;
  poolPosterior: PosteriorPoolSummary | null;
}

export interface AppState {
  itinerary: RawItinerary | null;
  stops: StopState[];
  currentIndex: number;
  log: StopLogEntry[];
  dayId: string | null;
  pendingDrop: PendingDrop | null;
  awaitingAdvance: boolean;
  activeDecisionStopId: string | number | null;
  lastRecommendation: RecommendationSnapshot | null;
  mqaMap: Record<string, number>;
  posteriorConfig: PosteriorConfig;
  posteriorPool: PosteriorPoolState;
}

export const DEFAULT_POSTERIOR_CONFIG: PosteriorConfig = {
  priorStrength: 4,
  baseAlpha: 1e-6,
  baseBeta: 1e-6,
  credibleZ: 1.0,
  defaultScore: 3.5,
};

export function createAppState(): AppState {
  return {
    itinerary: null,
    stops: [],
    currentIndex: 0,
    log: [],
    dayId: null,
    pendingDrop: null,
    awaitingAdvance: false,
    activeDecisionStopId: null,
    lastRecommendation: null,
    mqaMap: {
      Bust: 0.0,
      Average: 3.5,
      Good: 4.2,
      Exceptional: 5.0,
    },
    posteriorConfig: { ...DEFAULT_POSTERIOR_CONFIG },
    posteriorPool: createPosteriorPoolState(),
  };
}

export function mapRawStopToState(stop: RawStop, config: PosteriorConfig): StopState {
  return {
    ...stop,
    status: 'tovisit',
    posterior: createPosterior(stop.score, config),
    mapsUrl: createMapsUrl(stop),
  };
}

export function createMapsUrl(stop: Pick<RawStop, 'lat' | 'lon' | 'name' | 'address'>): string | null {
  const queryParts: string[] = [];
  const hasLat = typeof stop.lat === 'number' && Number.isFinite(stop.lat);
  const hasLon = typeof stop.lon === 'number' && Number.isFinite(stop.lon);
  if (hasLat && hasLon) {
    queryParts.push(`${stop.lat},${stop.lon}`);
  }

  if (typeof stop.name === 'string' && stop.name.trim()) {
    queryParts.push(stop.name.trim());
  }

  if (typeof stop.address === 'string' && stop.address.trim()) {
    queryParts.push(stop.address.trim());
  }

  if (queryParts.length === 0) {
    return null;
  }

  const query = encodeURIComponent(queryParts.join(' '));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function selectActiveDay(days: RawDay[], preferredDayId?: string): RawDay | undefined {
  if (preferredDayId) {
    const match = days.find((d) => d?.dayId === preferredDayId);
    if (match) return match;
  }
  return (
    days.find((d) => Array.isArray(d?.stops) && d.stops.some((stop) => stop.type === 'store')) ??
    days[0]
  );
}

export function findNextToVisitIndex(stops: StopState[]): number {
  const index = stops.findIndex((s) => s.status === 'tovisit');
  return index === -1 ? stops.length : index;
}

export function summarizePosterior(posterior: Posterior): PosteriorSummary {
  return {
    alpha: posterior.alpha,
    beta: posterior.beta,
    mean: posterior.mean,
    meanNormalized: posterior.meanNormalized,
    std: posterior.std,
    variance: posterior.variance,
    lower: posterior.lower,
    upper: posterior.upper,
    observationCount: posterior.observationCount,
    totalQuality: posterior.totalQuality,
    lastObservation: posterior.lastObservation,
    priorNormalized: posterior.priorNormalized,
    pseudo: posterior.pseudo,
  };
}

export function buildPosteriorSummary(
  posterior: Posterior,
  meta: Pick<RecommendationMeta, 'diff' | 'zScore' | 'currentUcb' | 'remainingUcb'>,
): StopState['posteriorSummary'] {
  return {
    ...summarizePosterior(posterior),
    diff: meta.diff,
    zScore: meta.zScore,
    currentUcb: meta.currentUcb,
    remainingUcb: meta.remainingUcb,
  };
}

export function createLogEntry(params: {
  stop: StopState;
  mqaKey: string;
  mqaValue: number;
  recommendation: string;
  decisionReason: string;
  decisionMeta: RecommendationMeta;
  posteriorSummary: PosteriorSummary;
  poolSummary: PosteriorPoolSummary | null;
}): StopLogEntry {
  const { stop, mqaKey, mqaValue, recommendation, decisionReason, decisionMeta, posteriorSummary, poolSummary } =
    params;

  return {
    name: stop.name,
    mapsUrl: stop.mapsUrl,
    mqa: mqaKey,
    mqaValue,
    decision: recommendation,
    decisionReason,
    diff: decisionMeta.diff,
    zScore: decisionMeta.zScore,
    currentUcb: decisionMeta.currentUcb ?? null,
    remainingUcb: decisionMeta.remainingUcb ?? null,
    observationCount: decisionMeta.observationCount ?? null,
    posterior: posteriorSummary,
    pool: poolSummary,
    timestamp: new Date().toISOString(),
  };
}

export function humanizeReason(reason: string | null | undefined): string {
  if (!reason) return '';
  const text = reason
    .replace(/[-_]/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return text
    .replace(/\bMqa\b/g, 'MQA')
    .replace(/\bUcb\b/g, 'Upper Confidence Bound (UCB)');
}

export function buildRunInfoText(runId: string | undefined, runNote: string | undefined): string | null {
  const runLabel = runId ?? 'Unknown Run';
  const runNoteText = runNote ? ` - ${runNote}` : '';
  const text = `Run ID: ${runLabel}${runNoteText}`;
  return text.trim() ? text : null;
}

export function getPosteriorConfig(state: AppState): PosteriorConfig {
  return state.posteriorConfig;
}

export function formatPosteriorScore(value: number | null | undefined): string {
  return formatScore(value);
}
