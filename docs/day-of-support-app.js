(function () {
  'use strict';

  const SCORE_MIN = 0;
  const SCORE_MAX = 5;
  const SCORE_RANGE = SCORE_MAX - SCORE_MIN;
  const EPSILON = 1e-6;

  const appState = {
    itinerary: null,
    stops: [],
    currentIndex: 0,
    log: [],
    mqaMap: {
      Bust: 0.0,
      Average: 3.5,
      Good: 4.2,
      Exceptional: 5.0,
    },
    posteriorConfig: {
      priorStrength: 4,
      baseAlpha: EPSILON,
      baseBeta: EPSILON,
      credibleZ: 1.0,
      defaultScore: 3.5,
    },
    posteriorPool: {
      observedAlpha: 0,
      observedBeta: 0,
      observationCount: 0,
      totalObservedQuality: 0,
      lastObservation: null,
    },
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const dataElement = document.getElementById('itinerary-data');
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

    const day = appState.itinerary?.days?.[0];
    if (!day) {
      console.error('No day data available in itinerary.');
      return;
    }

    appState.stops = day.stops
      .filter((stop) => stop.type === 'store')
      .map((stop) => ({
        ...stop,
        status: 'tovisit',
        posterior: createPosterior(stop.score),
      }));

    appState.currentIndex = appState.stops.findIndex((s) => s.status === 'tovisit');
    if (appState.currentIndex === -1) {
      appState.currentIndex = appState.stops.length;
    }

    const runInfo = document.getElementById('run-info');
    if (runInfo && appState.itinerary) {
      const runId = appState.itinerary.runId ?? 'Unknown Run';
      const runNote = appState.itinerary.runNote ? ` - ${appState.itinerary.runNote}` : '';
      runInfo.textContent = `Run ID: ${runId}${runNote}`;
    }

    setupMQAOptions();
    renderAll();
    addEventListeners();
  }

  function setupMQAOptions() {
    const container = document.getElementById('mqa-select');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(appState.mqaMap).forEach(([key, value]) => {
      const div = document.createElement('div');
      div.className = 'flex items-center p-3 rounded-lg border border-stone-200 hover:bg-stone-50';
      div.innerHTML = `
        <input id="mqa-${key.toLowerCase()}" type="radio" name="mqa" value="${key}" class="h-4 w-4 text-teal-600 border-stone-300 focus:ring-teal-500">
        <label for="mqa-${key.toLowerCase()}" class="ml-3 block text-sm font-medium text-stone-700">
          ${key} <span class="text-xs text-stone-500">(${value.toFixed(1)})</span>
        </label>
      `;
      container.appendChild(div);
    });
  }

  function renderAll() {
    const currentStop = appState.stops[appState.currentIndex];
    const metrics = calculateMetrics(currentStop?.id);
    renderDashboard(metrics);
    renderItineraryList(currentStop);
    renderCurrentStore(currentStop);
    renderTripLog();
  }

  function calculateMetrics(excludeId) {
    const totalStores = appState.stops.length;
    const visitedStores = appState.stops.filter((s) => s.status === 'visited').length;
    const overallAvgScore =
      totalStores > 0
        ? (
            appState.stops.reduce(
              (sum, s) => sum + (typeof s.score === 'number' ? s.score : appState.posteriorConfig.defaultScore),
              0,
            ) / totalStores
          ).toFixed(1)
        : '0.0';

    const poolPosterior = computeRemainingPoolPosterior(excludeId);
    const currentStop = appState.stops[appState.currentIndex];

    return {
      totalStores,
      visitedStores,
      overallAvgScore,
      poolPosterior,
      currentPosterior: currentStop ? currentStop.posterior : null,
      expectedRemQuality: poolPosterior ? poolPosterior.mean.toFixed(2) : '0.0',
    };
  }

  function renderDashboard(metrics) {
    const {
      totalStores,
      visitedStores,
      overallAvgScore,
      poolPosterior,
      currentPosterior,
    } = metrics;

    setText('dashboard-total-stores', totalStores);
    setText('dashboard-stores-visited', visitedStores);
    setText('dashboard-avg-jscore', overallAvgScore);
    setText(
      'dashboard-expected-quality',
      poolPosterior ? poolPosterior.mean.toFixed(2) : '--',
    );
    setText(
      'dashboard-pool-uncertainty',
      poolPosterior ? `±${poolPosterior.std.toFixed(2)}` : '±--',
    );
    setText(
      'dashboard-current-mean',
      currentPosterior ? currentPosterior.mean.toFixed(2) : '--',
    );
    setText(
      'dashboard-current-uncertainty',
      currentPosterior ? `±${currentPosterior.std.toFixed(2)}` : '±--',
    );
    const currentUcbText =
      currentPosterior?.lastObservation != null
        ? currentPosterior.lastObservation.toFixed(2)
        : '--';
    const remainingUcbText = poolPosterior ? poolPosterior.mean.toFixed(2) : '--';
    setText('dashboard-current-ucb', currentUcbText);
    setText('dashboard-remaining-ucb', remainingUcbText);
  }

  function renderItineraryList(currentStop) {
    const container = document.getElementById('itinerary-list');
    if (!container) return;
    container.innerHTML = '';
    appState.stops.forEach((stop, index) => {
      const isCurrent = currentStop && stop.id === currentStop.id && stop.status === 'tovisit';
      const div = document.createElement('div');
      div.id = `row-${stop.id}`;
      div.className = `p-3 rounded-md transition-all duration-300 ease-in-out status-${stop.status} ${
        isCurrent ? 'ring-2 ring-teal-500 shadow-md' : 'shadow-sm'
      }`;
      const posteriorMean = stop.posterior ? stop.posterior.mean.toFixed(2) : formatScore(stop.score);
      const posteriorStd = stop.posterior ? stop.posterior.std.toFixed(2) : '0.00';
      const initialScore = formatScore(stop.score);
      const statusLabel =
        stop.status === 'visited'
          ? `Visited – ${stop.mqa ?? 'n/a'}`
          : stop.status === 'dropped'
          ? 'Dropped'
          : 'To Visit';
      div.innerHTML = `
        <div class="flex justify-between items-start">
          <div>
            <p class="font-semibold">${stop.name}</p>
            <p class="text-xs text-stone-500">${statusLabel}</p>
          </div>
          <div class="text-right">
            <p class="font-mono text-sm bg-stone-200 text-stone-700 px-2 py-1 rounded">${posteriorMean}</p>
            <div class="mt-2 space-y-1 leading-tight">
              <div>
                <p class="text-xs uppercase tracking-wide text-stone-600">
                  Uncertainty&nbsp;:&nbsp;±${posteriorStd}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-stone-600">
                  Initial Score&nbsp;:&nbsp;${initialScore}</p>
              </div>
            </div>
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  function renderCurrentStore(currentStop) {
    const nameEl = document.getElementById('current-store-name');
    const form = document.getElementById('mqa-form');
    if (!nameEl || !form) return;

    if (!currentStop || currentStop.status !== 'tovisit') {
      nameEl.textContent = 'Trip Complete!';
      form.style.display = 'none';
      setText('timeline-arrive-time', '--:--');
      setText('timeline-mqa-time', '--:--');
      return;
    }

    form.style.display = 'block';
    nameEl.textContent = currentStop.name;

    const [arriveH, arriveM] = currentStop.arrive.split(':').map(Number);
    const mqaTime = new Date();
    mqaTime.setHours(arriveH, arriveM + 30, 0, 0);
    const mqaH = String(mqaTime.getHours()).padStart(2, '0');
    const mqaM = String(mqaTime.getMinutes()).padStart(2, '0');

    setText('timeline-arrive-time', currentStop.arrive);
    setText('timeline-mqa-time', `${mqaH}:${mqaM}`);
  }

  function renderTripLog() {
    const container = document.getElementById('trip-log');
    if (!container) return;

    if (appState.log.length === 0) {
      container.innerHTML = '<p class="text-stone-500">Your decisions will appear here.</p>';
      return;
    }

    container.innerHTML = '';
    appState.log.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'p-2 border-b border-stone-100';
      const posterior = entry.posterior;
      const pool = entry.pool;
      const mqaValueText = entry.mqaValue != null ? ` (${entry.mqaValue.toFixed(1)})` : '';
      const zScoreText = entry.zScore != null ? ` | z=${entry.zScore.toFixed(2)}` : '';
      const currentUcbText =
        entry.currentUcb != null && Number.isFinite(entry.currentUcb)
          ? entry.currentUcb.toFixed(2)
          : '--';
      const remainingUcbText =
        entry.remainingUcb != null && Number.isFinite(entry.remainingUcb)
          ? entry.remainingUcb.toFixed(2)
          : '--';
      div.innerHTML = `
        <p class="font-medium">${entry.name}</p>
        <p class="text-stone-600">MQA: <span class="font-semibold">${entry.mqa}</span>${mqaValueText} → Decision: <span class="font-semibold">${entry.decision}</span></p>
        <p class="text-xs text-stone-500">Posterior μ=${posterior.mean.toFixed(2)} σ=${posterior.std.toFixed(2)} | UCB=${currentUcbText} | Pool μ=${pool.mean.toFixed(2)} σ=${pool.std.toFixed(2)} | Pool UCB=${remainingUcbText}${
        zScoreText ? ` ${zScoreText}` : ''
      }</p>
      `;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  }

  function processDecision(mqaKey) {
    const currentStop = appState.stops[appState.currentIndex];
    if (!currentStop) return;

    const mqaValue = appState.mqaMap[mqaKey];
    if (typeof mqaValue !== 'number') {
      console.warn('Unknown MQA key selected:', mqaKey);
      return;
    }

    updateStopPosterior(currentStop, mqaValue);
    updatePoolObservation(mqaValue);

    const poolPosterior = computeRemainingPoolPosterior(currentStop.id);
    const decisionMeta = getRecommendation(
      currentStop.posterior,
      poolPosterior,
      mqaKey,
      mqaValue,
    );
    const recommendation = decisionMeta.decision;

    updateRecommendationDisplay(recommendation, decisionMeta, currentStop.posterior, poolPosterior);

    currentStop.mqa = mqaKey;
    currentStop.mqaValue = mqaValue;
    currentStop.decision = recommendation;
    currentStop.decisionReason = decisionMeta.reason;
    currentStop.status = 'visited';
    currentStop.posteriorSummary = serializePosterior(currentStop.posterior);
    currentStop.posteriorSummary.diff = decisionMeta.diff;
    currentStop.posteriorSummary.zScore = decisionMeta.zScore;
    currentStop.posteriorSummary.currentUcb = decisionMeta.currentUcb ?? null;
    currentStop.posteriorSummary.remainingUcb = decisionMeta.remainingUcb ?? null;

    appState.log.push({
      name: currentStop.name,
      mqa: mqaKey,
      mqaValue,
      decision: recommendation,
      decisionReason: decisionMeta.reason,
      diff: decisionMeta.diff,
      zScore: decisionMeta.zScore,
      currentUcb: decisionMeta.currentUcb ?? null,
      remainingUcb: decisionMeta.remainingUcb ?? null,
      observationCount: decisionMeta.observationCount ?? null,
      posterior: serializePosterior(currentStop.posterior),
      pool: serializePool(poolPosterior),
      timestamp: new Date().toISOString(),
    });

    renderAll();

    if (recommendation === 'Stay' && mqaKey === 'Exceptional') {
      handleOverrun();
    } else {
      advanceToNextStore();
    }
  }

  function updateRecommendationDisplay(recommendation, meta, currentPosterior, poolPosterior) {
    const display = document.getElementById('recommendation-display');
    if (!display) return;
    const diffText = meta.diff != null ? `ΔUCB=${meta.diff.toFixed(2)}` : '';
    const zText = meta.zScore != null && Number.isFinite(meta.zScore) ? `z=${meta.zScore.toFixed(2)}` : '';
    const reason = humanizeReason(meta.reason);
    const currentUcbText =
      meta.currentUcb != null && Number.isFinite(meta.currentUcb)
        ? meta.currentUcb.toFixed(2)
        : '--';
    const currentSummary = currentPosterior
      ? `Current μ=${currentPosterior.mean.toFixed(2)} σ=${currentPosterior.std.toFixed(2)} UCB=${currentUcbText}`
      : '';
    const poolUcbText =
      meta.remainingUcb != null && Number.isFinite(meta.remainingUcb)
        ? meta.remainingUcb.toFixed(2)
        : '--';
    const poolSummary = poolPosterior
      ? `Pool μ=${poolPosterior.mean.toFixed(2)} σ=${poolPosterior.std.toFixed(2)} UCB=${poolUcbText}`
      : '';

    const metaLine = [reason, diffText, zText].filter(Boolean).join(' · ');
    const summaryLine = [currentSummary, poolSummary].filter(Boolean).join(' | ');

    display.innerHTML = `
      <p class="text-lg font-medium">Recommendation:</p>
      <p class="text-3xl font-bold recommendation-${recommendation.toLowerCase()}">${recommendation.toUpperCase()}</p>
      <p class="text-sm text-stone-600">${metaLine}</p>
      <p class="text-xs text-stone-500">${summaryLine}</p>
    `;
  }

  function handleOverrun() {
    const remainingStops = appState.stops.filter((s) => s.status === 'tovisit');
    if (remainingStops.length === 0) {
      advanceToNextStore();
      return;
    }

    const lowestScoringStop = remainingStops.reduce((min, stop) =>
      stop.posterior.mean < min.posterior.mean ? stop : min,
    );

    setTimeout(() => {
      const confirmed = window.confirm(
        `To extend your stay, drop the lowest-rated remaining store:\n\n${lowestScoringStop.name} (Posterior μ: ${lowestScoringStop.posterior.mean.toFixed(
          2,
        )})\n\nDrop this store?`,
      );

      if (confirmed) {
        const stopToDrop = appState.stops.find((s) => s.id === lowestScoringStop.id);
        if (stopToDrop) {
          stopToDrop.status = 'dropped';
          appState.log.push({
            name: stopToDrop.name,
            mqa: 'N/A',
            mqaValue: null,
            decision: 'Dropped',
            decisionReason: 'overrun-drop-lowest',
            diff: null,
            zScore: null,
            posterior: serializePosterior(stopToDrop.posterior),
            pool: serializePool(computeRemainingPoolPosterior()),
            timestamp: new Date().toISOString(),
          });
        }
      }
      advanceToNextStore();
    }, 500);
  }

  function advanceToNextStore() {
    let nextIndex = appState.currentIndex + 1;
    while (nextIndex < appState.stops.length && appState.stops[nextIndex].status !== 'tovisit') {
      nextIndex += 1;
    }
    appState.currentIndex = nextIndex;

    const selectedRadio = document.querySelector('input[name="mqa"]:checked');
    if (selectedRadio) selectedRadio.checked = false;
    const display = document.getElementById('recommendation-display');
    if (display) display.innerHTML = '';

    renderAll();
  }

  function addEventListeners() {
    const decisionButton = document.getElementById('decision-button');
    if (decisionButton) {
      decisionButton.addEventListener('click', () => {
        const selectedMQA = document.querySelector('input[name="mqa"]:checked');
        if (!selectedMQA) {
          window.alert('Please select a Measured Quality Assessment (MQA).');
          return;
        }
        processDecision(selectedMQA.value);
      });
    }

    const bustButton = document.getElementById('bust-button');
    if (bustButton) {
      bustButton.addEventListener('click', () => {
        processDecision('Bust');
      });
    }

    const exportButton = document.getElementById('export-button');
    if (exportButton) {
      exportButton.addEventListener('click', () => {
        const poolSnapshot = computeRemainingPoolPosterior();
        const exportData = {
          runInfo: appState.itinerary,
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
            posterior: serializePosterior(stop.posterior),
          })),
          tripLog: appState.log,
          posteriorPool: {
            ...serializePool(poolSnapshot),
            observedAlpha: appState.posteriorPool.observedAlpha,
            observedBeta: appState.posteriorPool.observedBeta,
            observationCount: appState.posteriorPool.observationCount,
            totalObservedQuality: appState.posteriorPool.totalObservedQuality,
          },
          posteriorConfig: appState.posteriorConfig,
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const a = document.createElement('a');
        a.href = url;
        const runId = appState.itinerary?.runId ?? 'trip';
        a.download = `rust-belt-trip-${runId}-results.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }
  }

  function getRecommendation(currentPosterior, poolPosterior, mqaKey, mqaValue) {
    const currentUcb = typeof mqaValue === 'number' ? mqaValue : null;
    const remainingUcb = poolPosterior ? poolPosterior.mean : null;
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

  function computeRemainingPoolPosterior(excludeId) {
    const remainingStops = appState.stops.filter(
      (s) => s.status === 'tovisit' && (!excludeId || s.id !== excludeId),
    );

    let pseudoAlpha = 0;
    let pseudoBeta = 0;
    remainingStops.forEach((stop) => {
      const priorNorm = stop.posterior?.priorNormalized ?? normalizeScore(stop.score);
      const pseudo = stop.posterior?.pseudo ?? appState.posteriorConfig.priorStrength;
      pseudoAlpha += priorNorm * pseudo;
      pseudoBeta += (1 - priorNorm) * pseudo;
    });

    const alpha = appState.posteriorConfig.baseAlpha + pseudoAlpha + appState.posteriorPool.observedAlpha;
    const beta = appState.posteriorConfig.baseBeta + pseudoBeta + appState.posteriorPool.observedBeta;
    const stats = computeBetaStats(alpha, beta);
    return {
      ...stats,
      count: remainingStops.length,
      pseudoAlpha,
      pseudoBeta,
      observationCount: appState.posteriorPool.observationCount,
      totalObservedQuality: appState.posteriorPool.totalObservedQuality,
    };
  }

  function createPosterior(baseScore) {
    const normalized = normalizeScore(baseScore);
    const pseudo = appState.posteriorConfig.priorStrength;
    const posterior = {
      alpha: appState.posteriorConfig.baseAlpha + normalized * pseudo,
      beta: appState.posteriorConfig.baseBeta + (1 - normalized) * pseudo,
      priorNormalized: normalized,
      pseudo,
      observationCount: 0,
      totalQuality: 0,
      lastObservation: null,
    };
    return recomputePosteriorStats(posterior);
  }

  function updateStopPosterior(stop, mqaValue) {
    const normalized = normalizeScore(mqaValue);
    stop.posterior.alpha += normalized;
    stop.posterior.beta += 1 - normalized;
    stop.posterior.observationCount = (stop.posterior.observationCount ?? 0) + 1;
    stop.posterior.totalQuality = (stop.posterior.totalQuality ?? 0) + mqaValue;
    stop.posterior.lastObservation = mqaValue;
    recomputePosteriorStats(stop.posterior);
  }

  function updatePoolObservation(mqaValue) {
    const normalized = normalizeScore(mqaValue);
    appState.posteriorPool.observedAlpha += normalized;
    appState.posteriorPool.observedBeta += 1 - normalized;
    appState.posteriorPool.observationCount += 1;
    appState.posteriorPool.totalObservedQuality += mqaValue;
    appState.posteriorPool.lastObservation = mqaValue;
  }

  function recomputePosteriorStats(posterior) {
    posterior.alpha = Math.max(posterior.alpha, EPSILON);
    posterior.beta = Math.max(posterior.beta, EPSILON);
    const total = posterior.alpha + posterior.beta;
    const meanNormalized = posterior.alpha / total;
    const varianceNormalized = (posterior.alpha * posterior.beta) / ((total + 1) * total * total);
    const stdScore = Math.sqrt(Math.max(varianceNormalized, 0)) * SCORE_RANGE;
    posterior.meanNormalized = meanNormalized;
    posterior.mean = denormalizeScore(meanNormalized);
    posterior.std = stdScore;
    posterior.lower = clamp(
      posterior.mean - appState.posteriorConfig.credibleZ * stdScore,
      SCORE_MIN,
      SCORE_MAX,
    );
    posterior.upper = clamp(
      posterior.mean + appState.posteriorConfig.credibleZ * stdScore,
      SCORE_MIN,
      SCORE_MAX,
    );
    posterior.variance = stdScore * stdScore;
    return posterior;
  }

  function computeBetaStats(alpha, beta) {
    const safeAlpha = Math.max(alpha, EPSILON);
    const safeBeta = Math.max(beta, EPSILON);
    const total = safeAlpha + safeBeta;
    const meanNormalized = safeAlpha / total;
    const varianceNormalized = (safeAlpha * safeBeta) / ((total + 1) * total * total);
    const stdScore = Math.sqrt(Math.max(varianceNormalized, 0)) * SCORE_RANGE;
    const meanScore = denormalizeScore(meanNormalized);
    const lower = clamp(
      meanScore - appState.posteriorConfig.credibleZ * stdScore,
      SCORE_MIN,
      SCORE_MAX,
    );
    const upper = clamp(
      meanScore + appState.posteriorConfig.credibleZ * stdScore,
      SCORE_MIN,
      SCORE_MAX,
    );
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

  function serializePosterior(posterior) {
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
      priorNormalized: posterior.priorNormalized ?? null,
      pseudo: posterior.pseudo ?? appState.posteriorConfig.priorStrength,
    };
  }

  function serializePool(poolPosterior) {
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

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function normalizeScore(value) {
    const safeValue = typeof value === 'number' ? value : appState.posteriorConfig.defaultScore;
    return clamp((safeValue - SCORE_MIN) / SCORE_RANGE, 0, 1);
  }

  function denormalizeScore(normalized) {
    return SCORE_MIN + clamp(normalized, 0, 1) * SCORE_RANGE;
  }

  function formatScore(value) {
    if (typeof value !== 'number') return '0.0';
    return value.toFixed(1);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function humanizeReason(reason) {
    if (!reason) return '';
    const text = reason
      .replace(/[-_]/g, ' ')
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
    return text.replace(/\bMqa\b/g, 'MQA').replace(/\bUcb\b/g, 'UCB');
  }
})();
