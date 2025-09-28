"use strict";
(() => {
  // src/io/dayOfApp/recommendation.ts
  function getRecommendation(currentPosterior, poolPosterior, mqaKey, mqaValue) {
    var _a;
    const fallbackCurrentUcb = typeof mqaValue === "number" ? mqaValue : null;
    const derivedCurrentUcb = currentPosterior && typeof currentPosterior.upper === "number" ? currentPosterior.upper : null;
    const currentUcb = derivedCurrentUcb != null ? derivedCurrentUcb : fallbackCurrentUcb;
    const derivedRemainingUcb = poolPosterior && typeof poolPosterior.upper === "number" ? poolPosterior.upper : null;
    const fallbackRemainingUcb = poolPosterior && typeof poolPosterior.mean === "number" ? poolPosterior.mean : null;
    const remainingUcb = derivedRemainingUcb != null ? derivedRemainingUcb : fallbackRemainingUcb;
    const observationCount = (_a = currentPosterior == null ? void 0 : currentPosterior.observationCount) != null ? _a : 0;
    if (mqaKey === "Bust") {
      const diff2 = currentUcb != null && remainingUcb != null ? currentUcb - remainingUcb : currentUcb != null ? currentUcb : null;
      return {
        decision: "Leave",
        reason: "mqa-bust",
        diff: diff2,
        zScore: null,
        currentUcb,
        remainingUcb,
        observationCount
      };
    }
    if (!currentPosterior || currentUcb == null) {
      return {
        decision: "Leave",
        reason: "no-current-posterior",
        diff: null,
        zScore: null,
        currentUcb,
        remainingUcb,
        observationCount
      };
    }
    if (!poolPosterior || poolPosterior.count === 0 || remainingUcb == null) {
      return {
        decision: "Stay",
        reason: "no-remaining-stops",
        diff: currentUcb,
        zScore: null,
        currentUcb,
        remainingUcb,
        observationCount
      };
    }
    const diff = currentUcb - remainingUcb;
    const combinedStd = Math.sqrt(
      currentPosterior.std * currentPosterior.std + poolPosterior.std * poolPosterior.std
    );
    const zScore = combinedStd > 0 ? diff / combinedStd : diff >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (diff > 0) {
      return {
        decision: "Stay",
        reason: "ucb-favors-current",
        diff,
        zScore,
        currentUcb,
        remainingUcb,
        observationCount
      };
    }
    return {
      decision: "Leave",
      reason: diff === 0 ? "ucb-tie" : "ucb-favors-remaining",
      diff,
      zScore,
      currentUcb,
      remainingUcb,
      observationCount
    };
  }

  // src/io/dayOfApp/posterior.ts
  var SCORE_MIN = 0;
  var SCORE_MAX = 5;
  var SCORE_RANGE = SCORE_MAX - SCORE_MIN;
  var EPSILON = 1e-6;
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function normalizeScore(value, config) {
    const safeValue = typeof value === "number" ? value : config.defaultScore;
    return clamp((safeValue - SCORE_MIN) / SCORE_RANGE, 0, 1);
  }
  function denormalizeScore(normalized) {
    return SCORE_MIN + clamp(normalized, 0, 1) * SCORE_RANGE;
  }
  function formatScore(value) {
    if (typeof value !== "number") return "0.0";
    return value.toFixed(1);
  }
  function recomputePosteriorStats(posterior, config) {
    posterior.alpha = Math.max(posterior.alpha, EPSILON);
    posterior.beta = Math.max(posterior.beta, EPSILON);
    const total = posterior.alpha + posterior.beta;
    const meanNormalized = posterior.alpha / total;
    const varianceNormalized = posterior.alpha * posterior.beta / ((total + 1) * total * total);
    const stdScore = Math.sqrt(Math.max(varianceNormalized, 0)) * SCORE_RANGE;
    posterior.meanNormalized = meanNormalized;
    posterior.mean = denormalizeScore(meanNormalized);
    posterior.std = stdScore;
    posterior.lower = clamp(posterior.mean - config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
    posterior.upper = clamp(posterior.mean + config.credibleZ * stdScore, SCORE_MIN, SCORE_MAX);
    posterior.variance = stdScore * stdScore;
    return posterior;
  }
  function createPosterior(baseScore, config) {
    const normalized = normalizeScore(baseScore, config);
    const pseudo = config.priorStrength;
    const posterior = {
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
      upper: SCORE_MAX
    };
    return recomputePosteriorStats(posterior, config);
  }
  function updatePosteriorWithObservation(posterior, mqaValue, config) {
    var _a, _b;
    const normalized = normalizeScore(mqaValue, config);
    posterior.alpha += normalized;
    posterior.beta += 1 - normalized;
    posterior.observationCount = ((_a = posterior.observationCount) != null ? _a : 0) + 1;
    posterior.totalQuality = ((_b = posterior.totalQuality) != null ? _b : 0) + mqaValue;
    posterior.lastObservation = mqaValue;
    return recomputePosteriorStats(posterior, config);
  }
  function computeBetaStats(alpha, beta, config) {
    const safeAlpha = Math.max(alpha, EPSILON);
    const safeBeta = Math.max(beta, EPSILON);
    const total = safeAlpha + safeBeta;
    const meanNormalized = safeAlpha / total;
    const varianceNormalized = safeAlpha * safeBeta / ((total + 1) * total * total);
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
      upper
    };
  }
  function computeRemainingPoolPosterior(stops, config, pool, excludeId) {
    var _a, _b, _c, _d;
    let pseudoAlpha = 0;
    let pseudoBeta = 0;
    const remainingStops = stops.filter(
      (stop) => stop.status === "tovisit" && (excludeId === void 0 || String(stop.id) !== String(excludeId))
    );
    for (const stop of remainingStops) {
      const priorNorm = (_b = (_a = stop.posterior) == null ? void 0 : _a.priorNormalized) != null ? _b : normalizeScore(stop.score, config);
      const pseudo = (_d = (_c = stop.posterior) == null ? void 0 : _c.pseudo) != null ? _d : config.priorStrength;
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
      totalObservedQuality: pool.totalObservedQuality
    };
  }
  function serializePosterior(posterior, config) {
    var _a, _b, _c, _d, _e;
    return {
      alpha: posterior.alpha,
      beta: posterior.beta,
      mean: posterior.mean,
      meanNormalized: posterior.meanNormalized,
      std: posterior.std,
      variance: posterior.variance,
      lower: posterior.lower,
      upper: posterior.upper,
      observationCount: (_a = posterior.observationCount) != null ? _a : 0,
      totalQuality: (_b = posterior.totalQuality) != null ? _b : 0,
      lastObservation: (_c = posterior.lastObservation) != null ? _c : null,
      priorNormalized: (_d = posterior.priorNormalized) != null ? _d : normalizeScore(config.defaultScore, config),
      pseudo: (_e = posterior.pseudo) != null ? _e : config.priorStrength
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
      totalObservedQuality: poolPosterior.totalObservedQuality
    };
  }
  function createPosteriorPoolState() {
    return {
      observedAlpha: 0,
      observedBeta: 0,
      observationCount: 0,
      totalObservedQuality: 0,
      lastObservation: null
    };
  }
  function updatePoolObservation(pool, mqaValue, config) {
    const normalized = normalizeScore(mqaValue, config);
    pool.observedAlpha += normalized;
    pool.observedBeta += 1 - normalized;
    pool.observationCount += 1;
    pool.totalObservedQuality += mqaValue;
    pool.lastObservation = mqaValue;
  }

  // src/io/dayOfApp/state.ts
  var DEFAULT_POSTERIOR_CONFIG = {
    priorStrength: 4,
    baseAlpha: 1e-6,
    baseBeta: 1e-6,
    credibleZ: 1,
    defaultScore: 3.5
  };
  function createAppState() {
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
        Bust: 0,
        Average: 3.5,
        Good: 4.2,
        Exceptional: 5
      },
      posteriorConfig: { ...DEFAULT_POSTERIOR_CONFIG },
      posteriorPool: createPosteriorPoolState()
    };
  }
  function mapRawStopToState(stop, config) {
    return {
      ...stop,
      status: "tovisit",
      posterior: createPosterior(stop.score, config),
      mapsUrl: createMapsUrl(stop)
    };
  }
  function createMapsUrl(stop) {
    const queryParts = [];
    const hasLat = typeof stop.lat === "number" && Number.isFinite(stop.lat);
    const hasLon = typeof stop.lon === "number" && Number.isFinite(stop.lon);
    if (hasLat && hasLon) {
      queryParts.push(`${stop.lat},${stop.lon}`);
    }
    if (typeof stop.name === "string" && stop.name.trim()) {
      queryParts.push(stop.name.trim());
    }
    if (typeof stop.address === "string" && stop.address.trim()) {
      queryParts.push(stop.address.trim());
    }
    if (queryParts.length === 0) {
      return null;
    }
    const query = encodeURIComponent(queryParts.join(" "));
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
  function selectActiveDay(days, preferredDayId) {
    var _a;
    if (preferredDayId) {
      const match = days.find((d) => (d == null ? void 0 : d.dayId) === preferredDayId);
      if (match) return match;
    }
    return (_a = days.find((d) => Array.isArray(d == null ? void 0 : d.stops) && d.stops.some((stop) => stop.type === "store"))) != null ? _a : days[0];
  }
  function findNextToVisitIndex(stops) {
    const index = stops.findIndex((s) => s.status === "tovisit");
    return index === -1 ? stops.length : index;
  }
  function summarizePosterior(posterior) {
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
      pseudo: posterior.pseudo
    };
  }
  function buildPosteriorSummary(posterior, meta) {
    return {
      ...summarizePosterior(posterior),
      diff: meta.diff,
      zScore: meta.zScore,
      currentUcb: meta.currentUcb,
      remainingUcb: meta.remainingUcb
    };
  }
  function createLogEntry(params) {
    var _a, _b, _c;
    const { stop, mqaKey, mqaValue, recommendation, decisionReason, decisionMeta, posteriorSummary, poolSummary } = params;
    return {
      name: stop.name,
      mapsUrl: stop.mapsUrl,
      mqa: mqaKey,
      mqaValue,
      decision: recommendation,
      decisionReason,
      diff: decisionMeta.diff,
      zScore: decisionMeta.zScore,
      currentUcb: (_a = decisionMeta.currentUcb) != null ? _a : null,
      remainingUcb: (_b = decisionMeta.remainingUcb) != null ? _b : null,
      observationCount: (_c = decisionMeta.observationCount) != null ? _c : null,
      posterior: posteriorSummary,
      pool: poolSummary,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function humanizeReason(reason) {
    if (!reason) return "";
    const text = reason.replace(/[-_]/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase());
    return text.replace(/\bMqa\b/g, "MQA").replace(/\bUcb\b/g, "Upper Confidence Bound (UCB)");
  }
  function getPosteriorConfig(state) {
    return state.posteriorConfig;
  }
  function formatPosteriorScore(value) {
    return formatScore(value);
  }

  // src/io/dayOfApp/index.ts
  var appState = createAppState();
  var stopCardTemplateCache = null;
  var stopCardTemplateErrorLogged = false;
  function init(doc = document) {
    var _a, _b, _c, _d, _e, _f, _g;
    const dataElement = doc.getElementById("itinerary-data");
    if (!dataElement) {
      console.error("Itinerary data script tag not found.");
      return;
    }
    try {
      appState.itinerary = JSON.parse(dataElement.textContent || "{}");
    } catch (err) {
      console.error("Failed to parse itinerary JSON.", err);
      return;
    }
    const days = Array.isArray((_a = appState.itinerary) == null ? void 0 : _a.days) ? appState.itinerary.days : [];
    const activeDayId = (_c = (_b = doc.body) == null ? void 0 : _b.dataset) == null ? void 0 : _c.activeDayId;
    const day = selectActiveDay(days, activeDayId != null ? activeDayId : void 0);
    if (!day) {
      console.error("Unable to determine active day for itinerary.");
      return;
    }
    appState.dayId = (_d = day.dayId) != null ? _d : null;
    if (doc.body && appState.dayId) {
      doc.body.dataset.activeDayId = appState.dayId;
    }
    const dayLabel = doc.getElementById("active-day-label");
    if (dayLabel && day.dayId) {
      dayLabel.textContent = `Day ${day.dayId}`;
    }
    const stops = Array.isArray(day.stops) ? day.stops : [];
    const config = (_e = getPosteriorConfig(appState)) != null ? _e : DEFAULT_POSTERIOR_CONFIG;
    appState.stops = stops.filter((stop) => stop.type === "store").map((stop) => mapRawStopToState(stop, config));
    appState.currentIndex = findNextToVisitIndex(appState.stops);
    const runInfo = doc.getElementById("run-info");
    if (runInfo && appState.itinerary) {
      const existing = (_f = runInfo.textContent) == null ? void 0 : _f.trim();
      if (!existing) {
        const runId = (_g = appState.itinerary.runId) != null ? _g : "Unknown Run";
        const runNote = appState.itinerary.runNote ? ` - ${appState.itinerary.runNote}` : "";
        runInfo.textContent = `Run ID: ${runId}${runNote}`;
      }
    }
    setupMQAOptions(doc);
    renderAll(doc);
    addEventListeners(doc);
  }
  function setupMQAOptions(doc) {
    const container = doc.getElementById("mqa-select");
    if (!container) return;
    container.innerHTML = "";
    Object.entries(appState.mqaMap).forEach(([key, value]) => {
      const div = doc.createElement("div");
      div.className = "flex items-center p-3 rounded-lg border border-stone-200 hover:bg-stone-50";
      div.innerHTML = `
      <input id="mqa-${key.toLowerCase()}" type="radio" name="mqa" value="${key}" class="h-4 w-4 text-teal-600 border-stone-200 focus:ring-teal-500">
      <label for="mqa-${key.toLowerCase()}" class="ml-3 block text-sm font-medium text-stone-700">
        ${key} <span class="text-xs text-stone-500">(${value.toFixed(1)})</span>
      </label>
    `;
      container.appendChild(div);
    });
  }
  function renderAll(doc) {
    const currentStop = appState.stops[appState.currentIndex];
    const metrics = calculateMetrics(currentStop == null ? void 0 : currentStop.id);
    renderDashboard(doc, metrics);
    renderItineraryList(doc, currentStop != null ? currentStop : null);
    renderCurrentStore(doc, currentStop != null ? currentStop : null);
    renderTripLog(doc);
    refreshRecommendationDisplay(doc);
  }
  function calculateMetrics(excludeId) {
    const config = getPosteriorConfig(appState);
    const totalStores = appState.stops.length;
    const visitedStores = appState.stops.filter((s) => s.status === "visited").length;
    const overallAvgScore = totalStores > 0 ? (appState.stops.reduce(
      (sum, s) => sum + (typeof s.score === "number" ? s.score : config.defaultScore),
      0
    ) / totalStores).toFixed(1) : "0.0";
    const poolPosterior = appState.stops.length > 0 ? computeRemainingPoolPosterior(appState.stops, config, appState.posteriorPool, excludeId) : null;
    const currentStop = appState.stops[appState.currentIndex];
    return {
      totalStores,
      visitedStores,
      overallAvgScore,
      poolPosterior,
      currentPosterior: currentStop ? serializePosterior(currentStop.posterior, config) : null,
      expectedRemQuality: poolPosterior ? poolPosterior.mean.toFixed(2) : "0.0"
    };
  }
  function renderDashboard(doc, metrics) {
    const { totalStores, visitedStores, overallAvgScore, poolPosterior, currentPosterior } = metrics;
    setText(doc, "dashboard-total-stores", String(totalStores));
    setText(doc, "dashboard-stores-visited", String(visitedStores));
    setText(doc, "dashboard-avg-jscore", overallAvgScore);
    setText(doc, "dashboard-expected-quality", poolPosterior ? poolPosterior.mean.toFixed(2) : "--");
    setText(doc, "dashboard-pool-uncertainty", poolPosterior ? `\xB1${poolPosterior.std.toFixed(2)}` : "\xB1--");
    setText(doc, "dashboard-current-mean", currentPosterior ? currentPosterior.mean.toFixed(2) : "--");
    setText(
      doc,
      "dashboard-current-uncertainty",
      currentPosterior ? `\xB1${currentPosterior.std.toFixed(2)}` : "\xB1--"
    );
    const currentUcbText = currentPosterior && typeof currentPosterior.upper === "number" ? currentPosterior.upper.toFixed(2) : "--";
    const remainingUcbText = poolPosterior && typeof poolPosterior.upper === "number" ? poolPosterior.upper.toFixed(2) : "--";
    setText(doc, "dashboard-current-ucb", currentUcbText);
    setText(doc, "dashboard-remaining-ucb", remainingUcbText);
  }
  function renderItineraryList(doc, currentStop) {
    const container = doc.getElementById("itinerary-list");
    if (!container) return;
    container.replaceChildren();
    if (!getStopCardTemplate(doc)) {
      return;
    }
    appState.stops.forEach((stop) => {
      const awaitingStopId = appState.awaitingAdvance ? appState.activeDecisionStopId : null;
      const isAwaitingCurrent = awaitingStopId != null && String(stop.id) === String(awaitingStopId);
      const isCurrent = currentStop && stop.id === currentStop.id && stop.status === "tovisit" || isAwaitingCurrent;
      const card = createStopCardElement(doc, stop, {
        highlight: isCurrent,
        includeDropButton: stop.status === "tovisit"
      });
      if (card) {
        container.appendChild(card);
      }
    });
  }
  function renderCurrentStore(doc, currentStop) {
    const nameEl = doc.getElementById("current-store-name");
    const form = doc.getElementById("mqa-form");
    if (!nameEl || !form) return;
    const awaitingCurrent = appState.awaitingAdvance && currentStop && String(currentStop.id) === String(appState.activeDecisionStopId);
    if (!currentStop || currentStop.status !== "tovisit" && !awaitingCurrent) {
      nameEl.textContent = "Trip Complete!";
      form.style.display = "none";
      setText(doc, "timeline-arrive-time", "--:--");
      setText(doc, "timeline-mqa-time", "--:--");
      return;
    }
    form.style.display = awaitingCurrent ? "none" : "block";
    while (nameEl.firstChild) {
      nameEl.removeChild(nameEl.firstChild);
    }
    const currentName = typeof currentStop.name === "string" ? currentStop.name : "";
    if (currentStop.mapsUrl) {
      const link = doc.createElement("a");
      link.className = "store-link";
      link.href = currentStop.mapsUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = currentName;
      nameEl.appendChild(link);
    } else {
      nameEl.textContent = currentName;
    }
    if (currentStop.arrive) {
      const [arriveH, arriveM] = currentStop.arrive.split(":").map(Number);
      const mqaTime = /* @__PURE__ */ new Date();
      mqaTime.setHours(arriveH, arriveM + 30, 0, 0);
      const mqaH = String(mqaTime.getHours()).padStart(2, "0");
      const mqaM = String(mqaTime.getMinutes()).padStart(2, "0");
      setText(doc, "timeline-arrive-time", currentStop.arrive);
      setText(doc, "timeline-mqa-time", `${mqaH}:${mqaM}`);
    } else {
      setText(doc, "timeline-arrive-time", "--:--");
      setText(doc, "timeline-mqa-time", "--:--");
    }
  }
  function renderTripLog(doc) {
    const container = doc.getElementById("trip-log");
    if (!container) return;
    if (appState.log.length === 0) {
      container.innerHTML = '<p class="text-stone-500">Your decisions will appear here.</p>';
      return;
    }
    container.innerHTML = "";
    appState.log.forEach((entry) => {
      var _a, _b, _c;
      const div = doc.createElement("div");
      div.className = "p-2 border-b border-stone-100";
      const posterior = entry.posterior;
      const pool = entry.pool;
      const mqaValueText = entry.mqaValue != null ? entry.mqaValue.toFixed(1) : "\u2014";
      const summaryParts = [
        `MQA: ${entry.mqa} (${mqaValueText})`,
        entry.decisionReason ? `Reason: ${humanizeReason(entry.decisionReason)}` : null
      ].filter(Boolean);
      div.innerHTML = `
      <div class="flex justify-between items-start gap-3">
        <div>
          <p class="font-semibold">${entry.name}</p>
          <p class="text-xs text-stone-500">${summaryParts.join(" \xB7 ")}</p>
        </div>
        <div class="text-right text-xs text-stone-500">
          <p class="font-mono text-sm">${posterior.mean.toFixed(2)} \xB1 ${posterior.std.toFixed(2)}</p>
          <p>UCB: ${posterior.upper.toFixed(2)}</p>
        </div>
      </div>
      <p class="text-xs text-stone-400 mt-1">Pool \u03BC=${(_a = pool == null ? void 0 : pool.mean.toFixed(2)) != null ? _a : "\u2014"} \u03C3=${(_b = pool == null ? void 0 : pool.std.toFixed(2)) != null ? _b : "\u2014"} UCB=${(_c = pool == null ? void 0 : pool.upper.toFixed(2)) != null ? _c : "\u2014"}</p>
      <p class="text-xs text-stone-400">${new Date(entry.timestamp).toLocaleTimeString()}</p>
    `;
      container.appendChild(div);
    });
  }
  function refreshRecommendationDisplay(doc) {
    if (!appState.lastRecommendation) return;
    const { recommendation, meta, currentPosterior, poolPosterior } = appState.lastRecommendation;
    updateRecommendationDisplay(doc, recommendation, meta, currentPosterior, poolPosterior);
  }
  function getStopCardTemplate(doc) {
    if (stopCardTemplateCache) {
      return stopCardTemplateCache;
    }
    const template = doc.getElementById("stop-card-template");
    if (template instanceof HTMLTemplateElement) {
      stopCardTemplateCache = template;
      return template;
    }
    if (!stopCardTemplateErrorLogged) {
      console.error("Stop card template not found.");
      stopCardTemplateErrorLogged = true;
    }
    return null;
  }
  function createStopCardElement(doc, stop, options = {}) {
    var _a;
    const template = getStopCardTemplate(doc);
    if (!template) {
      return null;
    }
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".stop-card");
    if (!(card instanceof HTMLElement)) {
      return null;
    }
    const { highlight = false, includeDropButton = false } = options;
    const stopId = (stop == null ? void 0 : stop.id) != null ? String(stop.id) : "";
    if (stopId) {
      card.id = `row-${stopId}`;
      card.dataset.stopId = stopId;
    } else {
      card.removeAttribute("id");
      delete card.dataset.stopId;
    }
    if ((stop == null ? void 0 : stop.type) != null) {
      card.dataset.stopType = String(stop.type);
    } else {
      delete card.dataset.stopType;
    }
    card.classList.remove("status-tovisit", "status-visited", "status-dropped");
    const statusClass = (stop == null ? void 0 : stop.status) ? `status-${stop.status}` : "status-tovisit";
    card.classList.add(statusClass);
    if (highlight) {
      card.classList.add("ring-2", "ring-teal-500", "shadow-md");
      card.classList.remove("shadow-sm");
    }
    const stopName = typeof (stop == null ? void 0 : stop.name) === "string" ? stop.name : "";
    const nameTextEl = card.querySelector(".stop-name-text");
    const nameLinkEl = card.querySelector(".stop-name-link");
    if (nameTextEl) {
      nameTextEl.textContent = stopName;
    }
    if (nameLinkEl) {
      nameLinkEl.textContent = stopName;
      if (stop == null ? void 0 : stop.mapsUrl) {
        nameLinkEl.href = stop.mapsUrl;
        nameLinkEl.classList.remove("hidden");
        if (nameTextEl) {
          nameTextEl.classList.add("hidden");
        }
      } else {
        nameLinkEl.removeAttribute("href");
        nameLinkEl.classList.add("hidden");
        if (nameTextEl) {
          nameTextEl.classList.remove("hidden");
        }
      }
    }
    const statusLabel = (stop == null ? void 0 : stop.status) === "visited" ? `Visited \u2013 ${(_a = stop.mqa) != null ? _a : "n/a"}` : (stop == null ? void 0 : stop.status) === "dropped" ? "Dropped" : "To Visit";
    const statusEl = card.querySelector(".stop-status");
    if (statusEl) {
      statusEl.textContent = statusLabel;
    }
    const posteriorMean = stop.posterior ? stop.posterior.mean.toFixed(2) : formatPosteriorScore(stop.score);
    const posteriorStd = stop.posterior ? stop.posterior.std.toFixed(2) : "0.00";
    const initialScore = formatPosteriorScore(stop.score);
    const meanEl = card.querySelector(".stop-posterior-mean");
    if (meanEl) {
      meanEl.textContent = posteriorMean;
    }
    const uncertaintyEl = card.querySelector(".stop-posterior-uncertainty");
    if (uncertaintyEl) {
      uncertaintyEl.textContent = `Uncertainty\xA0:\xA0\xB1${posteriorStd}`;
    }
    const initialScoreEl = card.querySelector(".stop-initial-score");
    if (initialScoreEl) {
      initialScoreEl.textContent = `Initial Score\xA0:\xA0${initialScore}`;
    }
    const dropButton = card.querySelector(".drop-store-button");
    if (dropButton) {
      if (includeDropButton && stopId) {
        dropButton.hidden = false;
        dropButton.dataset.dropStopId = stopId;
      } else {
        dropButton.hidden = true;
        dropButton.removeAttribute("data-drop-stop-id");
      }
    }
    return card;
  }
  function addEventListeners(doc) {
    const decisionButton = doc.getElementById("decision-button");
    if (decisionButton) {
      decisionButton.addEventListener("click", () => {
        const selectedMQA = doc.querySelector('input[name="mqa"]:checked');
        if (!selectedMQA) {
          window.alert("Please select a Measured Quality Assessment (MQA).");
          return;
        }
        processDecision(doc, selectedMQA.value);
      });
    }
    const bustButton = doc.getElementById("bust-button");
    if (bustButton) {
      bustButton.addEventListener("click", () => {
        processDecision(doc, "Bust");
      });
    }
    const itineraryList = doc.getElementById("itinerary-list");
    if (itineraryList) {
      itineraryList.addEventListener("click", (event) => {
        var _a;
        const target = event.target;
        if (!target) {
          return;
        }
        const button = target.closest("button[data-drop-stop-id]");
        if (!button) {
          return;
        }
        event.preventDefault();
        const stopId = button.getAttribute("data-drop-stop-id");
        if (!stopId) {
          return;
        }
        const stop = appState.stops.find((s) => String(s.id) === stopId);
        if (!stop || stop.status !== "tovisit") {
          return;
        }
        const matchedPendingDrop = !!appState.pendingDrop && String((_a = appState.pendingDrop.stopId) != null ? _a : appState.pendingDrop.id) === stopId;
        const confirmed = window.confirm(`Drop ${stop.name}?

This will mark the store as dropped.`);
        if (!confirmed) {
          return;
        }
        const dropResult = dropStopById(stopId, "manual-drop");
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
    const exportButton = doc.getElementById("export-button");
    if (exportButton) {
      exportButton.addEventListener("click", () => {
        var _a, _b;
        const poolSnapshot = appState.stops.length ? computeRemainingPoolPosterior(appState.stops, getPosteriorConfig(appState), appState.posteriorPool) : null;
        const exportData = {
          runInfo: appState.itinerary,
          activeDayId: appState.dayId,
          finalStopsState: appState.stops.map((stop) => {
            var _a2, _b2, _c, _d;
            return {
              id: stop.id,
              name: stop.name,
              type: stop.type,
              arrive: stop.arrive,
              depart: stop.depart,
              score: stop.score,
              status: stop.status,
              mqa: (_a2 = stop.mqa) != null ? _a2 : null,
              mqaValue: (_b2 = stop.mqaValue) != null ? _b2 : null,
              decision: (_c = stop.decision) != null ? _c : null,
              decisionReason: (_d = stop.decisionReason) != null ? _d : null,
              posterior: serializePosterior(stop.posterior, getPosteriorConfig(appState))
            };
          }),
          tripLog: appState.log,
          posteriorPool: poolSnapshot ? {
            ...serializePool(poolSnapshot),
            observedAlpha: appState.posteriorPool.observedAlpha,
            observedBeta: appState.posteriorPool.observedBeta,
            observationCount: appState.posteriorPool.observationCount,
            totalObservedQuality: appState.posteriorPool.totalObservedQuality
          } : null,
          posteriorConfig: getPosteriorConfig(appState)
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(dataBlob);
        const a = doc.createElement("a");
        a.href = url;
        const runId = (_b = (_a = appState.itinerary) == null ? void 0 : _a.runId) != null ? _b : "trip";
        a.download = `rust-belt-trip-${runId}-results.json`;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }
  }
  function processDecision(doc, mqaKey) {
    const currentStop = appState.stops[appState.currentIndex];
    if (!currentStop) return;
    const mqaValue = appState.mqaMap[mqaKey];
    if (typeof mqaValue !== "number") {
      console.warn("Unknown MQA key selected:", mqaKey);
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
    const recommendationMeta = { ...decisionMeta };
    appState.lastRecommendation = {
      recommendation,
      meta: recommendationMeta,
      currentPosterior: posteriorSummary,
      poolPosterior: poolSummary
    };
    updateRecommendationDisplay(doc, recommendation, recommendationMeta, posteriorSummary, poolSummary);
    currentStop.mqa = mqaKey;
    currentStop.mqaValue = mqaValue;
    currentStop.decision = recommendation;
    currentStop.decisionReason = decisionMeta.reason;
    currentStop.status = "visited";
    currentStop.posteriorSummary = buildPosteriorSummary(currentStop.posterior, recommendationMeta);
    const shouldPauseBeforeAdvancing = recommendation === "Stay" && mqaKey === "Exceptional";
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
      poolSummary
    });
    appState.log.push(logEntry);
    renderAll(doc);
    if (recommendation === "Stay" && mqaKey === "Exceptional") {
      handleOverrun(doc);
    } else {
      advanceToNextStore(doc);
    }
  }
  function updateRecommendationDisplay(doc, recommendation, meta, currentPosterior, poolPosterior) {
    const display = doc.getElementById("recommendation-display");
    if (!display) return;
    const diffText = meta.diff != null ? `\u0394Upper Confidence Bound (UCB)=${meta.diff.toFixed(2)}` : "";
    const zText = meta.zScore != null && Number.isFinite(meta.zScore) ? `z=${meta.zScore.toFixed(2)}` : "";
    const reason = humanizeReason(meta.reason);
    const currentUcbText = meta.currentUcb != null && Number.isFinite(meta.currentUcb) ? meta.currentUcb.toFixed(2) : "--";
    const currentSummary = currentPosterior ? `Current \u03BC=${currentPosterior.mean.toFixed(2)} \u03C3=${currentPosterior.std.toFixed(2)} Upper Confidence Bound (UCB)=${currentUcbText}` : "";
    const poolUcbText = meta.remainingUcb != null && Number.isFinite(meta.remainingUcb) ? meta.remainingUcb.toFixed(2) : "--";
    const poolSummary = poolPosterior ? `Pool \u03BC=${poolPosterior.mean.toFixed(2)} \u03C3=${poolPosterior.std.toFixed(2)} Upper Confidence Bound (UCB)=${poolUcbText}` : "";
    const metaLine = [reason, diffText, zText].filter(Boolean).join(" \xB7 ");
    const summaryLine = [currentSummary, poolSummary].filter(Boolean).join(" | ");
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
      const confirmButton = display.querySelector('[data-action="confirm-pending-drop"]');
      if (confirmButton) {
        confirmButton.addEventListener("click", () => confirmPendingDrop(doc));
      }
      const cancelButton = display.querySelector('[data-action="cancel-pending-drop"]');
      if (cancelButton) {
        cancelButton.addEventListener("click", () => cancelPendingDrop(doc));
      }
    }
    if (advanceControlsMarkup) {
      const advanceButton = display.querySelector('[data-action="advance-after-decision"]');
      if (advanceButton) {
        advanceButton.addEventListener("click", () => handleAdvanceAfterDecision(doc));
      }
    }
  }
  function buildPendingDropMarkup() {
    var _a;
    const pendingDrop = appState.pendingDrop;
    if (!pendingDrop) {
      return "";
    }
    const pendingStop = appState.stops.find(
      (s) => {
        var _a2, _b;
        return String(s.id) === String((_b = (_a2 = pendingDrop.stopId) != null ? _a2 : pendingDrop.id) != null ? _b : "");
      }
    );
    if (!pendingStop || pendingStop.status !== "tovisit") {
      appState.pendingDrop = null;
      return "";
    }
    const nameMarkup = pendingStop.mapsUrl ? `<a class="store-link" href="${pendingStop.mapsUrl}" target="_blank" rel="noopener noreferrer">${pendingStop.name}</a>` : pendingStop.name;
    const posteriorMean = pendingStop.posterior ? pendingStop.posterior.mean.toFixed(2) : formatPosteriorScore(pendingStop.score);
    const posteriorStd = pendingStop.posterior ? pendingStop.posterior.std.toFixed(2) : "0.00";
    const initialScore = formatPosteriorScore(pendingStop.score);
    const statusValue = pendingStop.status;
    const statusLabel = statusValue === "visited" ? `Visited \u2013 ${(_a = pendingStop.mqa) != null ? _a : "n/a"}` : statusValue === "dropped" ? "Dropped" : "To Visit";
    const scheduleParts = [];
    if (pendingStop.arrive) {
      scheduleParts.push(`Arrive ${pendingStop.arrive}`);
    }
    if (pendingStop.depart) {
      scheduleParts.push(`Depart ${pendingStop.depart}`);
    }
    const scheduleMarkup = scheduleParts.length > 0 ? `<p class="pending-drop-store-schedule">${scheduleParts.join(" \xB7 ")}</p>` : "";
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
                    <p class="text-xs uppercase tracking-wide text-stone-600">Uncertainty&nbsp;:&nbsp;\xB1${posteriorStd}</p>
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
  function buildAdvanceControlsMarkup() {
    const awaitingAdvance = appState.awaitingAdvance && appState.activeDecisionStopId != null;
    if (!awaitingAdvance) {
      return "";
    }
    const nextDisabled = !!appState.pendingDrop;
    const disabledAttr = nextDisabled ? 'disabled aria-disabled="true"' : "";
    const baseButtonClass = "next-store-button rounded-md px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-1";
    const buttonClass = nextDisabled ? `${baseButtonClass} bg-stone-300 text-stone-500 cursor-not-allowed focus:ring-stone-300` : `${baseButtonClass} bg-teal-600 text-white shadow hover:bg-teal-700 focus:ring-teal-500`;
    const helperText = nextDisabled ? '<p class="text-xs text-stone-500">Resolve the drop decision before continuing.</p>' : "";
    return `
        <div class="mt-4 flex flex-col gap-2">
          <button type="button" class="${buttonClass}" data-action="advance-after-decision" ${disabledAttr}>
            Next store
          </button>
          ${helperText}
        </div>
      `;
  }
  function dropStopById(stopId, reason) {
    var _a;
    const normalizedId = String(stopId);
    const stopIndex = appState.stops.findIndex((s) => String(s.id) === normalizedId);
    if (stopIndex === -1) return null;
    const stop = appState.stops[stopIndex];
    if (stop.status !== "tovisit") {
      return null;
    }
    stop.status = "dropped";
    stop.decision = "Dropped";
    stop.decisionReason = reason;
    const config = getPosteriorConfig(appState);
    const posteriorSummary = serializePosterior(stop.posterior, config);
    stop.posteriorSummary = {
      ...posteriorSummary,
      diff: null,
      zScore: null,
      currentUcb: null,
      remainingUcb: null
    };
    const poolSnapshot = computeRemainingPoolPosterior(appState.stops, config, appState.posteriorPool);
    appState.log.push({
      name: stop.name,
      mapsUrl: stop.mapsUrl,
      mqa: "N/A",
      mqaValue: null,
      decision: "Dropped",
      decisionReason: reason,
      diff: null,
      zScore: null,
      currentUcb: null,
      remainingUcb: null,
      observationCount: null,
      posterior: posteriorSummary,
      pool: serializePool(poolSnapshot),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (appState.pendingDrop && String((_a = appState.pendingDrop.stopId) != null ? _a : appState.pendingDrop.id) === normalizedId) {
      appState.pendingDrop = null;
    }
    return { stop, index: stopIndex };
  }
  function handleAdvanceAfterDecision(doc) {
    if (appState.pendingDrop) {
      return;
    }
    appState.awaitingAdvance = false;
    appState.activeDecisionStopId = null;
    advanceToNextStore(doc);
  }
  function confirmPendingDrop(doc) {
    var _a;
    const pendingDrop = appState.pendingDrop;
    if (!pendingDrop) return;
    const stopId = (_a = pendingDrop.stopId) != null ? _a : pendingDrop.id;
    if (stopId == null) {
      appState.pendingDrop = null;
      renderAll(doc);
      return;
    }
    const result = dropStopById(stopId, "stay-drop");
    if (!result) {
      appState.pendingDrop = null;
      renderAll(doc);
      return;
    }
    appState.pendingDrop = null;
    renderAll(doc);
  }
  function cancelPendingDrop(doc) {
    appState.pendingDrop = null;
    renderAll(doc);
  }
  function advanceToNextStore(doc) {
    appState.currentIndex = findNextToVisitIndex(appState.stops);
    renderAll(doc);
  }
  function handleOverrun(doc) {
    const remainingStops = appState.stops.filter((s) => s.status === "tovisit");
    if (remainingStops.length === 0) {
      appState.pendingDrop = null;
      appState.awaitingAdvance = false;
      appState.activeDecisionStopId = null;
      advanceToNextStore(doc);
      return;
    }
    const lowestStop = [...remainingStops].sort(
      (a, b) => {
        var _a, _b;
        return ((_a = a.posterior.mean) != null ? _a : 0) - ((_b = b.posterior.mean) != null ? _b : 0);
      }
    )[0];
    if (!lowestStop) {
      return;
    }
    appState.pendingDrop = { stopId: lowestStop.id };
    renderAll(doc);
  }
  function setText(doc, id, value) {
    const el = doc.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => init(document));
  }
  var index_default = { init };
})();
//# sourceMappingURL=day-of-app.js.map
