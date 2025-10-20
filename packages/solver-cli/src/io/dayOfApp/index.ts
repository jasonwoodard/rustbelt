import { getRecommendation } from './recommendation';
import {
  AppState,
  StopState,
  createAppState,
  mapRawStopToState,
  selectActiveDay,
  findNextToVisitIndex,
  createLogEntry,
  buildPosteriorSummary,
  humanizeReason,
  getPosteriorConfig,
  formatPosteriorScore,
  DEFAULT_POSTERIOR_CONFIG,
} from './state';
import {
  PosteriorPoolPosterior,
  computeRemainingPoolPosterior,
  serializePosterior,
  serializePool,
  updatePosteriorWithObservation,
  updatePoolObservation,
  PosteriorPoolSummary,
  PosteriorSummary,
} from './posterior';

type Nullable<T> = T | null;

type DecisionMeta = ReturnType<typeof getRecommendation>;

const appState: AppState = createAppState();

let stopCardTemplateCache: HTMLTemplateElement | null = null;
let stopCardTemplateErrorLogged = false;

export function init(doc: Document = document): void {
  const dataElement = doc.getElementById('itinerary-data');
  if (!dataElement) {
    console.error('Itinerary data script tag not found.');
    return;
  }

  try {
    appState.itinerary = JSON.parse(dataElement.textContent || '{}');
  } catch (err) {
    console.error('Failed to parse itinerary JSON.', err);
    return;
  }

  const days = Array.isArray(appState.itinerary?.days) ? appState.itinerary.days : [];
  const activeDayId = doc.body?.dataset?.activeDayId;
  const day = selectActiveDay(days, activeDayId ?? undefined);
  if (!day) {
    console.error('Unable to determine active day for itinerary.');
    return;
  }

  appState.dayId = day.dayId ?? null;
  if (doc.body && appState.dayId) {
    doc.body.dataset.activeDayId = appState.dayId;
  }

  const dayLabel = doc.getElementById('active-day-label');
  if (dayLabel && day.dayId) {
    dayLabel.textContent = `Day ${day.dayId}`;
  }

  const stops = Array.isArray(day.stops) ? day.stops : [];
  const config = getPosteriorConfig(appState) ?? DEFAULT_POSTERIOR_CONFIG;
  appState.stops = stops
    .filter((stop) => stop.type === 'store')
    .map((stop) => mapRawStopToState(stop, config));

  appState.currentIndex = findNextToVisitIndex(appState.stops);

  const runInfo = doc.getElementById('run-info');
  if (runInfo && appState.itinerary) {
    const existing = runInfo.textContent?.trim();
    if (!existing) {
      const runId = appState.itinerary.runId ?? 'Unknown Run';
      const runNote = appState.itinerary.runNote ? ` - ${appState.itinerary.runNote}` : '';
      runInfo.textContent = `Run ID: ${runId}${runNote}`;
    }
  }

  setupMQAOptions(doc);
  renderAll(doc);
  addEventListeners(doc);
}

function setupMQAOptions(doc: Document): void {
  const container = doc.getElementById('mqa-select');
  if (!container) return;
  container.innerHTML = '';
  Object.entries(appState.mqaMap).forEach(([key, value]) => {
    const div = doc.createElement('div');
    div.className = 'flex items-center p-3 rounded-lg border border-stone-200 hover:bg-stone-50';
    div.innerHTML = `
      <input id="mqa-${key.toLowerCase()}" type="radio" name="mqa" value="${key}" class="h-4 w-4 text-teal-600 border-stone-200 focus:ring-teal-500">
      <label for="mqa-${key.toLowerCase()}" class="ml-3 block text-sm font-medium text-stone-700">
        ${key} <span class="text-xs text-stone-500">(${value.toFixed(1)})</span>
      </label>
    `;
    container.appendChild(div);
  });
}

function renderAll(doc: Document): void {
  const currentStop = appState.stops[appState.currentIndex];
  const metrics = calculateMetrics(currentStop?.id);
  renderDashboard(doc, metrics);
  renderItineraryList(doc, currentStop ?? null);
  renderCurrentStore(doc, currentStop ?? null);
  renderTripLog(doc);
  refreshRecommendationDisplay(doc);
}

interface DashboardMetrics {
  totalStores: number;
  visitedStores: number;
  overallAvgScore: string;
  poolPosterior: PosteriorPoolPosterior | null;
  currentPosterior: PosteriorSummary | null;
  expectedRemQuality: string;
}

function calculateMetrics(excludeId: string | number | undefined): DashboardMetrics {
  const config = getPosteriorConfig(appState);
  const totalStores = appState.stops.length;
  const visitedStores = appState.stops.filter((s) => s.status === 'visited').length;
  const overallAvgScore =
    totalStores > 0
      ? (
          appState.stops.reduce(
            (sum, s) => sum + (typeof s.score === 'number' ? s.score : config.defaultScore),
            0,
          ) / totalStores
        ).toFixed(1)
      : '0.0';

  const poolPosterior =
    appState.stops.length > 0
      ? computeRemainingPoolPosterior(appState.stops, config, appState.posteriorPool, excludeId)
      : null;
  const currentStop = appState.stops[appState.currentIndex];

  return {
    totalStores,
    visitedStores,
    overallAvgScore,
    poolPosterior,
    currentPosterior: currentStop ? serializePosterior(currentStop.posterior, config) : null,
    expectedRemQuality: poolPosterior ? poolPosterior.mean.toFixed(2) : '0.0',
  };
}

function renderDashboard(doc: Document, metrics: DashboardMetrics): void {
  const { totalStores, visitedStores, overallAvgScore, poolPosterior, currentPosterior } = metrics;
  setText(doc, 'dashboard-total-stores', String(totalStores));
  setText(doc, 'dashboard-stores-visited', String(visitedStores));
  setText(doc, 'dashboard-avg-jscore', overallAvgScore);
  setText(doc, 'dashboard-expected-quality', poolPosterior ? poolPosterior.mean.toFixed(2) : '--');
  setText(doc, 'dashboard-pool-uncertainty', poolPosterior ? `±${poolPosterior.std.toFixed(2)}` : '±--');
  setText(doc, 'dashboard-current-mean', currentPosterior ? currentPosterior.mean.toFixed(2) : '--');
  setText(
    doc,
    'dashboard-current-uncertainty',
    currentPosterior ? `±${currentPosterior.std.toFixed(2)}` : '±--',
  );
  const currentUcbText =
    currentPosterior && typeof currentPosterior.upper === 'number'
      ? currentPosterior.upper.toFixed(2)
      : '--';
  const remainingUcbText =
    poolPosterior && typeof poolPosterior.upper === 'number' ? poolPosterior.upper.toFixed(2) : '--';
  setText(doc, 'dashboard-current-ucb', currentUcbText);
  setText(doc, 'dashboard-remaining-ucb', remainingUcbText);
}

function renderItineraryList(doc: Document, currentStop: Nullable<StopState>): void {
  const container = doc.getElementById('itinerary-list');
  if (!container) return;
  container.replaceChildren();
  if (!getStopCardTemplate(doc)) {
    return;
  }
  appState.stops.forEach((stop) => {
    const awaitingStopId = appState.awaitingAdvance ? appState.activeDecisionStopId : null;
    const isAwaitingCurrent = awaitingStopId != null && String(stop.id) === String(awaitingStopId);
    const isCurrent =
      (currentStop && stop.id === currentStop.id && stop.status === 'tovisit') || isAwaitingCurrent;
    const card = createStopCardElement(doc, stop, {
      highlight: isCurrent,
      includeDropButton: stop.status === 'tovisit',
    });
    if (card) {
      container.appendChild(card);
    }
  });
}

function renderCurrentStore(doc: Document, currentStop: Nullable<StopState>): void {
  const nameEl = doc.getElementById('current-store-name');
  const form = doc.getElementById('mqa-form');
  if (!nameEl || !form) return;

  const awaitingCurrent =
    appState.awaitingAdvance &&
    currentStop &&
    String(currentStop.id) === String(appState.activeDecisionStopId);

  if (!currentStop || (currentStop.status !== 'tovisit' && !awaitingCurrent)) {
    nameEl.textContent = 'Trip Complete!';
    (form as HTMLElement).style.display = 'none';
    setText(doc, 'timeline-arrive-time', '--:--');
    setText(doc, 'timeline-mqa-time', '--:--');
    return;
  }

  (form as HTMLElement).style.display = awaitingCurrent ? 'none' : 'block';
  while (nameEl.firstChild) {
    nameEl.removeChild(nameEl.firstChild);
  }
  const currentName = typeof currentStop.name === 'string' ? currentStop.name : '';
  if (currentStop.mapsUrl) {
    const link = doc.createElement('a');
    link.className = 'store-link';
    link.href = currentStop.mapsUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = currentName;
    nameEl.appendChild(link);
  } else {
    nameEl.textContent = currentName;
  }

  if (currentStop.arrive) {
    const [arriveH, arriveM] = currentStop.arrive.split(':').map(Number);
    const mqaTime = new Date();
    mqaTime.setHours(arriveH, arriveM + 30, 0, 0);
    const mqaH = String(mqaTime.getHours()).padStart(2, '0');
    const mqaM = String(mqaTime.getMinutes()).padStart(2, '0');
    setText(doc, 'timeline-arrive-time', currentStop.arrive);
    setText(doc, 'timeline-mqa-time', `${mqaH}:${mqaM}`);
  } else {
    setText(doc, 'timeline-arrive-time', '--:--');
    setText(doc, 'timeline-mqa-time', '--:--');
  }
}

function renderTripLog(doc: Document): void {
  const container = doc.getElementById('trip-log');
  if (!container) return;

  if (appState.log.length === 0) {
    container.innerHTML = '<p class="text-stone-500">Your decisions will appear here.</p>';
    return;
  }

  container.innerHTML = '';
  appState.log.forEach((entry) => {
    const div = doc.createElement('div');
    div.className = 'p-2 border-b border-stone-100';
    const posterior = entry.posterior;
    const pool = entry.pool;
    const mqaValueText = entry.mqaValue != null ? entry.mqaValue.toFixed(1) : '—';
    const summaryParts = [
      `MQA: ${entry.mqa} (${mqaValueText})`,
      entry.decisionReason ? `Reason: ${humanizeReason(entry.decisionReason)}` : null,
    ].filter(Boolean);
    div.innerHTML = `
      <div class="flex justify-between items-start gap-3">
        <div>
          <p class="font-semibold">${entry.name}</p>
          <p class="text-xs text-stone-500">${summaryParts.join(' · ')}</p>
        </div>
        <div class="text-right text-xs text-stone-500">
          <p class="font-mono text-sm">${posterior.mean.toFixed(2)} ± ${posterior.std.toFixed(2)}</p>
          <p>UCB: ${posterior.upper.toFixed(2)}</p>
        </div>
      </div>
      <p class="text-xs text-stone-400 mt-1">Pool μ=${pool?.mean.toFixed(2) ?? '—'} σ=${
      pool?.std.toFixed(2) ?? '—'
    } UCB=${pool?.upper.toFixed(2) ?? '—'}</p>
      <p class="text-xs text-stone-400">${new Date(entry.timestamp).toLocaleTimeString()}</p>
    `;
    container.appendChild(div);
  });
}

function refreshRecommendationDisplay(doc: Document): void {
  if (!appState.lastRecommendation) return;
  const { recommendation, meta, currentPosterior, poolPosterior } = appState.lastRecommendation;
  updateRecommendationDisplay(doc, recommendation, meta, currentPosterior, poolPosterior);
}

function getStopCardTemplate(doc: Document): HTMLTemplateElement | null {
  if (stopCardTemplateCache) {
    return stopCardTemplateCache;
  }

  const template = doc.getElementById('stop-card-template');
  if (template instanceof HTMLTemplateElement) {
    stopCardTemplateCache = template;
    return template;
  }

  if (!stopCardTemplateErrorLogged) {
    console.error('Stop card template not found.');
    stopCardTemplateErrorLogged = true;
  }

  return null;
}

interface StopCardOptions {
  highlight?: boolean;
  includeDropButton?: boolean;
}

function createStopCardElement(
  doc: Document,
  stop: StopState,
  options: StopCardOptions = {},
): HTMLElement | null {
  const template = getStopCardTemplate(doc);
  if (!template) {
    return null;
  }

  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const card = fragment.querySelector('.stop-card');
  if (!(card instanceof HTMLElement)) {
    return null;
  }

  const { highlight = false, includeDropButton = false } = options;

  const stopId = stop?.id != null ? String(stop.id) : '';
  if (stopId) {
    card.id = `row-${stopId}`;
    card.dataset.stopId = stopId;
  } else {
    card.removeAttribute('id');
    delete card.dataset.stopId;
  }

  if (stop?.type != null) {
    card.dataset.stopType = String(stop.type);
  } else {
    delete card.dataset.stopType;
  }

  card.classList.remove('status-tovisit', 'status-visited', 'status-dropped');
  const statusClass = stop?.status ? `status-${stop.status}` : 'status-tovisit';
  card.classList.add(statusClass);

  if (highlight) {
    card.classList.add('ring-2', 'ring-teal-500', 'shadow-md');
    card.classList.remove('shadow-sm');
  }

  const stopName = typeof stop?.name === 'string' ? stop.name : '';
  const nameTextEl = card.querySelector('.stop-name-text');
  const nameLinkEl = card.querySelector('.stop-name-link') as HTMLAnchorElement | null;
  if (nameTextEl) {
    nameTextEl.textContent = stopName;
  }
  if (nameLinkEl) {
    nameLinkEl.textContent = stopName;
    if (stop?.mapsUrl) {
      nameLinkEl.href = stop.mapsUrl;
      nameLinkEl.classList.remove('hidden');
      if (nameTextEl) {
        nameTextEl.classList.add('hidden');
      }
    } else {
      nameLinkEl.removeAttribute('href');
      nameLinkEl.classList.add('hidden');
      if (nameTextEl) {
        nameTextEl.classList.remove('hidden');
      }
    }
  }

  const statusLabel =
    stop?.status === 'visited'
      ? `Visited – ${stop.mqa ?? 'n/a'}`
      : stop?.status === 'dropped'
      ? 'Dropped'
      : 'To Visit';
  const statusEl = card.querySelector('.stop-status');
  if (statusEl) {
    statusEl.textContent = statusLabel;
  }

  const posteriorMean = stop.posterior ? stop.posterior.mean.toFixed(2) : formatPosteriorScore(stop.score);
  const posteriorStd = stop.posterior ? stop.posterior.std.toFixed(2) : '0.00';
  const initialScore = formatPosteriorScore(stop.score);

  const meanEl = card.querySelector('.stop-posterior-mean');
  if (meanEl) {
    meanEl.textContent = posteriorMean;
  }

  const uncertaintyEl = card.querySelector('.stop-posterior-uncertainty');
  if (uncertaintyEl) {
    uncertaintyEl.textContent = `Uncertainty\u00A0:\u00A0±${posteriorStd}`;
  }

  const initialScoreEl = card.querySelector('.stop-initial-score');
  if (initialScoreEl) {
    initialScoreEl.textContent = `Initial Score\u00A0:\u00A0${initialScore}`;
  }

  const dropButton = card.querySelector('.drop-store-button') as HTMLButtonElement | null;
  if (dropButton) {
    if (includeDropButton && stopId) {
      dropButton.hidden = false;
      dropButton.dataset.dropStopId = stopId;
    } else {
      dropButton.hidden = true;
      dropButton.removeAttribute('data-drop-stop-id');
    }
  }

  return card;
}

function addEventListeners(doc: Document): void {
  const decisionButton = doc.getElementById('decision-button');
  if (decisionButton) {
    decisionButton.addEventListener('click', () => {
      const selectedMQA = doc.querySelector<HTMLInputElement>('input[name="mqa"]:checked');
      if (!selectedMQA) {
        window.alert('Please select a Measured Quality Assessment (MQA).');
        return;
      }
      processDecision(doc, selectedMQA.value);
    });
  }

  const bustButton = doc.getElementById('bust-button');
  if (bustButton) {
    bustButton.addEventListener('click', () => {
      processDecision(doc, 'Bust');
    });
  }

  const itineraryList = doc.getElementById('itinerary-list');
  if (itineraryList) {
    itineraryList.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      if (!target) {
        return;
      }
      const button = target.closest<HTMLButtonElement>('button[data-drop-stop-id]');
      if (!button) {
        return;
      }
      event.preventDefault();
      const stopId = button.getAttribute('data-drop-stop-id');
      if (!stopId) {
        return;
      }
      const stop = appState.stops.find((s) => String(s.id) === stopId);
      if (!stop || stop.status !== 'tovisit') {
        return;
      }
      const matchedPendingDrop =
        !!appState.pendingDrop && String(appState.pendingDrop.stopId ?? appState.pendingDrop.id) === stopId;
      const confirmed = window.confirm(`Drop ${stop.name}?\n\nThis will mark the store as dropped.`);
      if (!confirmed) {
        return;
      }
      const dropResult = dropStopById(stopId, 'manual-drop');
      if (!dropResult) {
        if (matchedPendingDrop) {
          appState.pendingDrop = null;
          renderAll(doc);
        }
        return;
      }
      if (matchedPendingDrop) {
        appState.pendingDrop = null;
        renderAll(doc);
      } else if (dropResult.index === appState.currentIndex) {
        advanceToNextStore(doc);
      } else {
        renderAll(doc);
      }
    });
  }

  const exportButton = doc.getElementById('export-button');
  if (exportButton) {
    exportButton.addEventListener('click', () => {
      const poolSnapshot = appState.stops.length
        ? computeRemainingPoolPosterior(appState.stops, getPosteriorConfig(appState), appState.posteriorPool)
        : null;
      const exportData = {
        runInfo: appState.itinerary,
        activeDayId: appState.dayId,
        finalStopsState: appState.stops.map((stop) => ({
          id: stop.id,
          name: stop.name,
          type: stop.type,
          arrive: stop.arrive,
          depart: stop.depart,
          score: stop.score,
          status: stop.status,
          mqa: stop.mqa ?? null,
          mqaValue: stop.mqaValue ?? null,
          decision: stop.decision ?? null,
          decisionReason: stop.decisionReason ?? null,
          posterior: serializePosterior(stop.posterior, getPosteriorConfig(appState)),
        })),
        tripLog: appState.log,
        posteriorPool: poolSnapshot
          ? {
              ...serializePool(poolSnapshot),
              observedAlpha: appState.posteriorPool.observedAlpha,
              observedBeta: appState.posteriorPool.observedBeta,
              observationCount: appState.posteriorPool.observationCount,
              totalObservedQuality: appState.posteriorPool.totalObservedQuality,
            }
          : null,
        posteriorConfig: getPosteriorConfig(appState),
      };
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const a = doc.createElement('a');
      a.href = url;
      const runId = appState.itinerary?.runId ?? 'trip';
      a.download = `rust-belt-trip-${runId}-results.json`;
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
}

function processDecision(doc: Document, mqaKey: string): void {
  const currentStop = appState.stops[appState.currentIndex];
  if (!currentStop) return;

  const mqaValue = appState.mqaMap[mqaKey];
  if (typeof mqaValue !== 'number') {
    console.warn('Unknown MQA key selected:', mqaKey);
    return;
  }

  const config = getPosteriorConfig(appState);
  updatePosteriorWithObservation(currentStop.posterior, mqaValue, config);
  updatePoolObservation(appState.posteriorPool, mqaValue, config);

  const poolPosterior = computeRemainingPoolPosterior(appState.stops, config, appState.posteriorPool, currentStop.id);
  const decisionMeta = getRecommendation(currentStop.posterior, poolPosterior, mqaKey, mqaValue);
  const recommendation = decisionMeta.decision;
  const posteriorSummary = serializePosterior(currentStop.posterior, config);
  const poolSummary = poolPosterior ? serializePool(poolPosterior) : null;
  const recommendationMeta: DecisionMeta = { ...decisionMeta };

  appState.lastRecommendation = {
    recommendation,
    meta: recommendationMeta,
    currentPosterior: posteriorSummary,
    poolPosterior: poolSummary,
  };

  updateRecommendationDisplay(doc, recommendation, recommendationMeta, posteriorSummary, poolSummary);

  currentStop.mqa = mqaKey;
  currentStop.mqaValue = mqaValue;
  currentStop.decision = recommendation;
  currentStop.decisionReason = decisionMeta.reason;
  currentStop.status = 'visited';
  currentStop.posteriorSummary = buildPosteriorSummary(currentStop.posterior, recommendationMeta);

  const shouldPauseBeforeAdvancing = recommendation === 'Stay' && mqaKey === 'Exceptional';
  appState.awaitingAdvance = shouldPauseBeforeAdvancing;
  appState.activeDecisionStopId = shouldPauseBeforeAdvancing ? currentStop.id : null;

  const logEntry = createLogEntry({
    stop: currentStop,
    mqaKey,
    mqaValue,
    recommendation,
    decisionReason: decisionMeta.reason,
    decisionMeta,
    posteriorSummary,
    poolSummary,
  });
  appState.log.push(logEntry);

  renderAll(doc);

  if (recommendation === 'Stay' && mqaKey === 'Exceptional') {
    handleOverrun(doc);
  } else {
    advanceToNextStore(doc);
  }
}

function updateRecommendationDisplay(
  doc: Document,
  recommendation: string,
  meta: DecisionMeta,
  currentPosterior: PosteriorSummary | null,
  poolPosterior: PosteriorPoolSummary | null,
): void {
  const display = doc.getElementById('recommendation-display');
  if (!display) return;
  const diffText = meta.diff != null ? `ΔUpper Confidence Bound (UCB)=${meta.diff.toFixed(2)}` : '';
  const zText = meta.zScore != null && Number.isFinite(meta.zScore) ? `z=${meta.zScore.toFixed(2)}` : '';
  const reason = humanizeReason(meta.reason);
  const currentUcbText =
    meta.currentUcb != null && Number.isFinite(meta.currentUcb)
      ? meta.currentUcb.toFixed(2)
      : '--';
  const currentSummary = currentPosterior
    ? `Current μ=${currentPosterior.mean.toFixed(2)} σ=${currentPosterior.std.toFixed(2)} Upper Confidence Bound (UCB)=${currentUcbText}`
    : '';
  const poolUcbText =
    meta.remainingUcb != null && Number.isFinite(meta.remainingUcb)
      ? meta.remainingUcb.toFixed(2)
      : '--';
  const poolSummary = poolPosterior
    ? `Pool μ=${poolPosterior.mean.toFixed(2)} σ=${poolPosterior.std.toFixed(2)} Upper Confidence Bound (UCB)=${poolUcbText}`
    : '';

  const metaLine = [reason, diffText, zText].filter(Boolean).join(' · ');
  const summaryLine = [currentSummary, poolSummary].filter(Boolean).join(' | ');

  const pendingDropMarkup = buildPendingDropMarkup();
  const advanceControlsMarkup = buildAdvanceControlsMarkup();

  const baseMarkup = `
      <p class="text-lg font-medium">Recommendation:</p>
      <p class="text-3xl font-bold recommendation-${recommendation.toLowerCase()}">${recommendation.toUpperCase()}</p>
      <p class="text-sm text-stone-600">${metaLine}</p>
      <p class="text-xs text-stone-500">${summaryLine}</p>
    `;

  display.innerHTML = `${baseMarkup}${pendingDropMarkup}${advanceControlsMarkup}`;

  if (pendingDropMarkup) {
    const confirmButton = display.querySelector('[data-action="confirm-pending-drop"]') as
      | HTMLButtonElement
      | null;
    if (confirmButton) {
      confirmButton.addEventListener('click', () => confirmPendingDrop(doc));
    }
    const cancelButton = display.querySelector('[data-action="cancel-pending-drop"]') as
      | HTMLButtonElement
      | null;
    if (cancelButton) {
      cancelButton.addEventListener('click', () => cancelPendingDrop(doc));
    }
  }
  if (advanceControlsMarkup) {
    const advanceButton = display.querySelector('[data-action="advance-after-decision"]') as
      | HTMLButtonElement
      | null;
    if (advanceButton) {
      advanceButton.addEventListener('click', () => handleAdvanceAfterDecision(doc));
    }
  }
}

function buildPendingDropMarkup(): string {
  const pendingDrop = appState.pendingDrop;
  if (!pendingDrop) {
    return '';
  }
  const pendingStop = appState.stops.find(
    (s) => String(s.id) === String(pendingDrop.stopId ?? pendingDrop.id ?? ''),
  );
  if (!pendingStop || pendingStop.status !== 'tovisit') {
    appState.pendingDrop = null;
    return '';
  }
  const nameMarkup = pendingStop.mapsUrl
    ? `<a class="store-link" href="${pendingStop.mapsUrl}" target="_blank" rel="noopener noreferrer">${pendingStop.name}</a>`
    : pendingStop.name;
  const posteriorMean = pendingStop.posterior ? pendingStop.posterior.mean.toFixed(2) : formatPosteriorScore(pendingStop.score);
  const posteriorStd = pendingStop.posterior ? pendingStop.posterior.std.toFixed(2) : '0.00';
  const initialScore = formatPosteriorScore(pendingStop.score);
  const statusValue = pendingStop.status as string;
  const statusLabel =
    statusValue === 'visited'
      ? `Visited – ${pendingStop.mqa ?? 'n/a'}`
      : statusValue === 'dropped'
      ? 'Dropped'
      : 'To Visit';
  const scheduleParts: string[] = [];
  if (pendingStop.arrive) {
    scheduleParts.push(`Arrive ${pendingStop.arrive}`);
  }
  if (pendingStop.depart) {
    scheduleParts.push(`Depart ${pendingStop.depart}`);
  }
  const scheduleMarkup =
    scheduleParts.length > 0 ? `<p class="pending-drop-store-schedule">${scheduleParts.join(' · ')}</p>` : '';
  const storeSummaryMarkup = `
          <div class="pending-drop-store p-3 rounded-md shadow-sm">
            <div class="flex justify-between items-start gap-3">
              <div>
                <p class="font-semibold pending-drop-store-name">${nameMarkup}</p>
                <p class="text-xs text-stone-500 pending-drop-store-status">${statusLabel}</p>
              </div>
              <div class="flex flex-col items-end text-right gap-2">
                <div class="text-right">
                  <p class="font-mono text-sm bg-stone-200 text-stone-700 px-2 py-1 rounded pending-drop-store-mean">${posteriorMean}</p>
                  <div class="mt-2 space-y-1 leading-tight pending-drop-store-metrics">
                    <p class="text-xs uppercase tracking-wide text-stone-600">Uncertainty&nbsp;:&nbsp;±${posteriorStd}</p>
                    <p class="text-xs uppercase tracking-wide text-stone-600">Initial Score&nbsp;:&nbsp;${initialScore}</p>
                  </div>
                </div>
              </div>
            </div>
            ${scheduleMarkup}
          </div>
        `;

  return `
      <div class="pending-drop-panel mt-4 rounded-lg p-4">
        <p class="pending-drop-title">Extend your stay?</p>
        <p class="pending-drop-subtitle">Drop the lowest-rated remaining store to stay longer.</p>
        ${storeSummaryMarkup}
        <div class="pending-drop-actions">
          <button
            type="button"
            class="pending-drop-action pending-drop-action--danger"
            data-action="confirm-pending-drop"
            data-stop-id="${pendingStop.id}"
          >
            Drop store?
          </button>
          <button
            type="button"
            class="pending-drop-action pending-drop-action--secondary"
            data-action="cancel-pending-drop"
          >
            Do NOT Drop
          </button>
        </div>
      </div>
    `;
}

function buildAdvanceControlsMarkup(): string {
  const awaitingAdvance = appState.awaitingAdvance && appState.activeDecisionStopId != null;
  if (!awaitingAdvance) {
    return '';
  }
  const nextDisabled = !!appState.pendingDrop;
  const disabledAttr = nextDisabled ? 'disabled aria-disabled="true"' : '';
  const baseButtonClass =
    'next-store-button rounded-md px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-1';
  const buttonClass = nextDisabled
    ? `${baseButtonClass} bg-stone-300 text-stone-500 cursor-not-allowed focus:ring-stone-300`
    : `${baseButtonClass} bg-teal-600 text-white shadow hover:bg-teal-700 focus:ring-teal-500`;
  const helperText = nextDisabled
    ? '<p class="text-xs text-stone-500">Resolve the drop decision before continuing.</p>'
    : '';
  return `
        <div class="mt-4 flex flex-col gap-2">
          <button type="button" class="${buttonClass}" data-action="advance-after-decision" ${disabledAttr}>
            Next store
          </button>
          ${helperText}
        </div>
      `;
}

function dropStopById(stopId: string | number, reason: string): { stop: StopState; index: number } | null {
  const normalizedId = String(stopId);
  const stopIndex = appState.stops.findIndex((s) => String(s.id) === normalizedId);
  if (stopIndex === -1) return null;

  const stop = appState.stops[stopIndex];
  if (stop.status !== 'tovisit') {
    return null;
  }

  stop.status = 'dropped';
  stop.decision = 'Dropped';
  stop.decisionReason = reason;

  const config = getPosteriorConfig(appState);
  const posteriorSummary = serializePosterior(stop.posterior, config);
  stop.posteriorSummary = {
    ...posteriorSummary,
    diff: null,
    zScore: null,
    currentUcb: null,
    remainingUcb: null,
  };

  const poolSnapshot = computeRemainingPoolPosterior(appState.stops, config, appState.posteriorPool);

  appState.log.push({
    name: stop.name,
    mapsUrl: stop.mapsUrl,
    mqa: 'N/A',
    mqaValue: null,
    decision: 'Dropped',
    decisionReason: reason,
    diff: null,
    zScore: null,
    currentUcb: null,
    remainingUcb: null,
    observationCount: null,
    posterior: posteriorSummary,
    pool: serializePool(poolSnapshot),
    timestamp: new Date().toISOString(),
  });

  if (
    appState.pendingDrop &&
    String(appState.pendingDrop.stopId ?? appState.pendingDrop.id) === normalizedId
  ) {
    appState.pendingDrop = null;
  }

  return { stop, index: stopIndex };
}

function handleAdvanceAfterDecision(doc: Document): void {
  if (appState.pendingDrop) {
    return;
  }
  appState.awaitingAdvance = false;
  appState.activeDecisionStopId = null;
  advanceToNextStore(doc);
}

function confirmPendingDrop(doc: Document): void {
  const pendingDrop = appState.pendingDrop;
  if (!pendingDrop) return;
  const stopId = pendingDrop.stopId ?? pendingDrop.id;
  if (stopId == null) {
    appState.pendingDrop = null;
    renderAll(doc);
    return;
  }
  const result = dropStopById(stopId, 'stay-drop');
  if (!result) {
    appState.pendingDrop = null;
    renderAll(doc);
    return;
  }
  appState.pendingDrop = null;
  renderAll(doc);
}

function cancelPendingDrop(doc: Document): void {
  appState.pendingDrop = null;
  renderAll(doc);
}

function advanceToNextStore(doc: Document): void {
  appState.currentIndex = findNextToVisitIndex(appState.stops);
  renderAll(doc);
}

function handleOverrun(doc: Document): void {
  const remainingStops = appState.stops.filter((s) => s.status === 'tovisit');
  if (remainingStops.length === 0) {
    appState.pendingDrop = null;
    appState.awaitingAdvance = false;
    appState.activeDecisionStopId = null;
    advanceToNextStore(doc);
    return;
  }
  const lowestStop = [...remainingStops].sort(
    (a, b) => (a.posterior.mean ?? 0) - (b.posterior.mean ?? 0),
  )[0];
  if (!lowestStop) {
    return;
  }
  appState.pendingDrop = { stopId: lowestStop.id };
  renderAll(doc);
}

function setText(doc: Document, id: string, value: string): void {
  const el = doc.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => init(document));
}

export default { init };
