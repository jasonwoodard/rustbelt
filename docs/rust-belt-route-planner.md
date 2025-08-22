# Project: Multi-Day Thrift Route Planner (OPTW-lite)

## Problem Frame & Goals

- **Goal:** Build a planner that **maximizes number of stores visited per day** on a multi-day Detroit → Cleveland (overnight) → Buffalo (overnight) trip, with fixed daily start/end anchors and simple travel modeling.  
- **Model:** A practical variant of the **Orienteering Problem** (OPTW-lite since we’re ignoring store hours in v0.x). Per day: choose and order stops to maximize count under a daily time budget (drive \+ dwell) using **Haversine distance × constant mph**.  
- **Key non-goal:** Shortest route. Efficiency is in service of **more stores while still reaching the hotel on time**.

# Features at a Glance 

FRs broken down by implementation milestone (v0.x)

## v0.1 — Core Day-By-Day Planner (MVP)

- **FR-1** Multi-day segmentation by day (**backtracking allowed**)  
- **FR-3** Auto partitioning into day subroutes  
- **FR-4** Maximize **store count** under daily time window  
- **FR-6** Tie-breakers: end-of-day slack → total drive  
- **FR-8** Per-store **dwell/service** time  
- **FR-9** Travel time via **Haversine \+ mph** (no road graph)  
- **FR-11** **Must-visit** stores (hard) only  
- **FR-17** Per-day itinerary output (arrive/depart, leg times, dwell, slack, hotel ETA)  
- **FR-18** Basic metrics summary  
- **FR-24** ET time handling  
- **FR-25** Validation (ids, coords, dwell, must-visits present; exact-coordinate dedupe)  
- **FR-28** Handle hundreds of candidates/day  
- **FR-29** Determinism via seed  
- **FR-30** Feasibility fixtures  
- **FR-31** Regression baselines

## v0.2 — Usability & Resilience

- **FR-14** Lock/Pin stops  
- **FR-21** **Live mid-day re-optimization** (current time/location \+ hotel)  
- **FR-13** Infeasibility reporting \+ **minimal relaxations**  
- **FR-18** Fuller diagnostics (bottlenecks)  
- **FR-28** Expose **best-so-far** solution & progress

## v0.3 — Power Controls & Robustness

- **FR-5** Objective: **score/utility** mode (or blend)  
- **FR-12** Daily caps (max drive/stops) & optional break window  
- **FR-15** Spatial filter: corridor/polygon (deferred stretch)  
- **FR-22** Robustness buffers & **On-Time Risk**

## v0.4 — Explainability & Scenarios (Stretch)

- **FR-16** Save/compare scenarios  
- **FR-20** Why-excluded \+ next-best alternative

## Out of Scope / De-scoped (for now)

- **FR-7** Store hours/time windows (assume open)  
- **FR-19** Turn-by-turn export / deep links  
- **FR-23** Special cluster handling (keep exact-coordinate dedupe only)  
- **FR-26**, **FR-27** Presets (nice-to-have future)

---

# 1\) Functional Requirements (Finalized & Versioned)

### Assumptions (apply to all versions unless noted)

- Single traveler, single vehicle.  
- **Backtracking permitted** if it increases total store count.  
- All stores assumed open (no time windows).  
- Travel time \= **Haversine distance / mph\_constant** (mph configurable).  
- All locations in Eastern Time; time zone handling is trivial but present.  
- Must-visit stores are hard constraints; no “avoid” list.

### Out of Scope (for now)

- Turn-by-turn exports (e.g., deep links to Maps).  
- Real road network routing.  
- Special cluster handling beyond exact-duplicate coordinate dedupe.  
- Store opening/closing windows.

---

## v0.1 — Core Day-By-Day Planner (MVP)

**FRs included:**  
FR-1 (day segmentation; backtracking allowed), FR-3, FR-4, FR-6 (basic tie-breakers), FR-8, FR-9 (Haversine+mph), FR-11 (must-visit), FR-17, FR-18 (basic), FR-24, FR-25, FR-28 (size target), FR-29, FR-30, FR-31.

**User story:** “Given my day start/end anchors, candidate stores (lat/lon \+ dwell), a daily driving window and mph, produce an ordered day itinerary that reaches the hotel and fits the clock while visiting as many stores as possible.”

**Acceptance criteria:**

- Returns a per-day ordered list with arrival/departure times, leg drive times, dwell, cumulative time, slack, and hotel ETA.  
- Includes all **must-visit** or declares infeasible (with reason).  
- Deterministic with a fixed random seed.  
- Handles \~300 candidates/day on a laptop in reasonable time.

---

## v0.2 — Usability & Resilience

**FRs included:**  
FR-14 (lock/pin), FR-21 (mid-day re-opt), FR-13 (infeasibility & minimal relaxation), FR-18 (full diagnostics), FR-28 (best-so-far/progress).

**User story:** “I can lock a couple stops, re-solve mid-day from my current time/location, and if it breaks, the tool tells me the smallest change to fix it.”

**Acceptance criteria:**

- Mid-day re-opt honors: current time/location, remaining day window, locks, end-of-day hotel.  
- Infeasible runs list a ranked set of **minimal relaxations** (e.g., extend day \+15 min; drop 1 stop; relax a lock).

---

## v0.3 — Power Controls & Robustness

**FRs included:**  
FR-5 (score/utility objective mode), FR-12 (daily limits: max drive time/stops; optional break window; defaults off), FR-15 (corridor/polygon), FR-22 (robustness buffers \+ risk view).

**User story:** “I can bias towards higher-value stores, enforce daily caps, confine routes to an I-80/I-90 corridor, and add a global timing buffer with risk indicators.”

**Acceptance criteria:**

- Switching to score mode changes selection order consistent with weights.  
- Out-of-bounds stores (by corridor/polygon) are excluded.  
- Robustness toggle inflates travel time, recalculates slack, and surfaces an **On-Time Risk** summary (fraction of legs with slack \< X).

---

## v0.4 — Explainability & Scenario Mgmt (Stretch)

**FRs included:**  
FR-16 (save/compare scenarios), FR-20 (why excluded \+ next-best).

**Acceptance criteria:**

- Scenario compare shows deltas for \#stores, total drive, dwell, slack, risk.  
- For any excluded store, a primary blocking reason and a nearest swap candidate are reported.

---

# 2\) Implementation Plan

## 2.1 Architecture Overview

**Layers & Modules**

1. **Core Model**  
     
   - `Location` (id, name, lat, lon, type={store, anchor}, mustVisit?: bool, score?: number)  
   - `DayConfig` (startLocation, endLocation, startTime, endTime, mph, defaultDwell, maxDriveTime?, maxStops?, breakWindow?)  
   - `ProblemInstance` (days: DayConfig\[\], candidatesByDay: Location\[\])

   

2. **Cost/Time Engine**  
     
   - Haversine distance (mi)  
   - Travel time \= distance / mph  
   - Dwell & buffer composition  
   - (v0.3) Global **robustness factor** to inflate travel times

   

3. **Day Solver (per day)**  
     
   - **Selector \+ Sequencer** that:  
     - Honors must-visits (seed route)  
     - Greedy/insertion heuristic, then local search (2-opt/Or-opt)  
     - Feasibility checks (end-of-day reachability)  
     - Tie-breakers (more end slack → shorter drive → median score)  
   - Returns `ItineraryDay` with stops, times, metrics

   

4. **Re-Optimization Engine (v0.2)**  
     
   - Rebuild **residual day** from current location/time with locked stops, maintaining hotel

   

5. **Constraints & Infeasibility Analyzer (v0.2)**  
     
   - Detects binding constraints; proposes **minimal relaxations** ranked by impact

   

6. **Spatial Filter (v0.3)**  
     
   - Corridor/polygon membership tests to prune candidate set pre-solve

   

7. **Scenario Manager (v0.4)**  
     
   - Parameter snapshots, diff & compare

   

8. **I/O Adapters**  
     
   - CLI / JSON in-out (v0.1)  
   - Optional lightweight web UI (later): upload store list, see itinerary & metrics

**Data Flow (per day)** Input (DayConfig \+ stores) → Filter (corridor/polygon v0.3) → Must-visit seed route → Greedy Insert (value \= 1 or score) subject to time budget → Local search improve (2-opt, relocate, swap) → Feasibility check to hotel → Metrics & diagnostics.

---

## 2.2 Algorithmic Approach (by version)

### v0.1 (simple, fast, effective)

- **Seed:** Start → (must-visits in nearest-neighbor order) → End.  
- **Insertion heuristic:** Repeatedly insert the **best next store** at the position with minimum **marginal time cost** that keeps the itinerary feasible (reaching hotel within day window).  
- **Local search:** 2-opt (edge swaps) \+ single-node relocate to reduce time and increase slack; accept only if feasible.  
- **Feasibility:** After each insertion/move, recompute cumulative drive \+ dwell; ensure hotel ETA ≤ day end.  
- **Tie-breakers:** Prefer moves that maximize end-of-day slack; then minimize total drive.  
- **Determinism:** Use seeded RNG for candidate ordering and tie resolution.

**Why this works:** Classic orienteering heuristics; cheap, explainable, and good under simple costs.

---

### v0.2 (control & resilience)

- **Lock/pin:** Treat locked stores as fixed nodes at fixed indices or relative positions (“first after start”, “last before hotel”).  
- **Re-opt:** From current time/location, drop completed/now-infeasible stores, keep locks, re-run v0.1 solver on remaining window.  
- **Infeasibility advisor:** Fast checks:  
  1. Tight end window bound violated? Propose extend day Δ or reduce dwell globally.  
  2. Must-visit chain infeasible? Propose dropping a specific must-visit (ranked by time burden) or relaxing lock positions.  
  3. Overfull store set? Propose reducing target count or increasing mph (if using conservative profile).  
- **Progress/best-so-far:** Iterative improvement loop surfaces the current incumbent solution between passes.

---

### v0.3 (power & robustness)

- **Objective mode:** Replace “+1 per store” with “+score”, or blend with λ: maximize λ·score \+ (1-λ)·count.  
- **Constraints:** Check **max drive** and **max stops** during insertion; break window as a pseudo-stop that must be scheduled.  
- **Spatial:** Pre-prune candidates outside corridor/polygon before solve.  
- **Robustness:** Inflate travel time by factor (e.g., 1.15) or lower mph. Report **On-Time Risk** \= fraction of legs with slack \< X (configurable).

---

### v0.4 (explainability & scenarios)

- **Why excluded:** For an excluded store S, compute the minimal insertion causing earliest end-of-day violation; identify blocking segment/store; report nearest viable swap candidate (Δ objective, Δ time).  
- **Scenarios:** Parameter snapshots (mph, dwell, objective mode, corridor, robustness). Compare KPIs and highlight differing store sets.

---

## 2.3 Technology Choices

**Language:**

- **TypeScript (Node.js)** for the main implementation (aligns with your prior TS preference; portable; easy CLI & future UI).  
- Rationale: Haversine \+ heuristics are straightforward; we don’t need heavy OR toolkits.

**Core Libraries:**

- Geodesy/Haversine: lightweight custom or tiny utility (no heavy deps).  
- CLI: `commander` or similar.  
- (Optional UI later) React \+ Vite if desired.

**Project Layout (TS)**

/src

  /core

    cost.ts           \# Haversine, mph, buffers

    types.ts          \# Location, DayConfig, ItineraryDay, etc.

    itinerary.ts      \# schedule build, feasibility checks, slack

    heuristics.ts     \# seed, insertion, 2-opt, relocate

    reopt.ts          \# mid-day re-optimization (v0.2)

    infeasibility.ts  \# minimal relaxations (v0.2)

    spatial.ts        \# corridor/polygon filters (v0.3)

    explain.ts        \# exclusions/swap analysis (v0.4)

  /io

    parse.ts          \# JSON/CSV import (stores, anchors)

    emit.ts           \# JSON/Markdown export of itinerary & metrics

  /app

    solveDay.ts       \# orchestrates a single day solve

    solveTrip.ts      \# partitions trip into days and runs per-day solver

    scenarios.ts      \# v0.4 scenarios

  index.ts            \# CLI entry

/tests

  fixtures/           \# v0.1 synthetic cases

  regression/         \# gold plans for v0.2+

**Interfaces (v0.1)**

- **Input JSON** (per day):  
    
  {  
    
    "dayId": "2025-10-01",  
    
    "start": {"id":"detroit", "lat":..., "lon":...},  
    
    "end":   {"id":"cleveland\_hotel", "lat":..., "lon":...},  
    
    "window": {"start":"09:00", "end":"18:30"},  
    
    "mph": 38,  
    
    "defaultDwellMin": 12,  
    
    "mustVisitIds": \["..."\],  
    
    "candidates": \[{"id":"s1","name":"...","lat":...,"lon":...,"dwellMin":12}, ...\]  
    
  }  
    
- **Output JSON**:  
    
  {  
    
    "dayId":"2025-10-01",  
    
    "stops":\[  
    
      {"id":"start","arrive":"09:00","depart":"09:00"},  
    
      {"id":"s1","arrive":"09:18","depart":"09:30","driveMin":18,"dwellMin":12},  
    
      ...  
    
      {"id":"hotel","arrive":"18:12","depart":"18:12"}  
    
    \],  
    
    "metrics":{"storesVisited": N, "totalDriveMin": X, "totalDwellMin": Y, "slackMin": Z}  
    
  }

*(We’ll flesh out full input spec in Task 2.)*

---

## 2.4 Testing & Quality Gates

**Unit/Property Tests**

- Haversine correctness (symmetry, triangle sanity).  
- Schedule builder invariants (no negative slack; non-decreasing times).  
- Feasibility: hotel ETA within window; must-visits present in path.  
- Determinism under seed.

**Fixture Suites (v0.1)**

- Dense cluster near corridor vs scattered far nodes → planner should pick clusters.  
- Must-visit far off route reduces count as expected.

**Regression (v0.2+)**

- Gold itineraries for representative days; ensure “no objective regression” unless intended.

**Performance Harness**

- Random Poisson fields (100–500 candidates) with fixed seed; assert completion under threshold ops and stable objective.

---

## 2.5 KPIs & Diagnostics (surfaced in output/CLI)

**Per Day:**

- `storesVisited`, `totalDriveMin`, `totalDwellMin`, `slackMin`, `onTimeLegs` (v0.3: `onTimeRisk`), `droppedMustVisits?` (should be none for feasible), `bindingConstraint` (if infeasible).

**Per Trip:**

- Sum of per-day metrics; list of included store IDs per day; (v0.4) scenario deltas.

**Explainability (progressively added):**

- v0.1: insertion logs (optional verbose) and final tie-break notes.  
- v0.2: infeasibility report \+ minimal relaxations.  
- v0.4: per-store exclusion reasons \+ swap candidate.

---

## 2.6 Risks & Mitigations

- **Heuristic myopia (local optimum):** Mitigate with multi-start seeds (different NN seeds), small beam width, and local search passes; expose “best-so-far”.  
- **Feasibility brittleness (tight windows):** Provide global dwell scaling and mph profile; v0.2 relaxations.  
- **User expectation drift (no real traffic/roads):** Make the mph constant explicit; v0.3 robustness factor and risk display.  
- **Complexity creep:** Version gates prevent premature features; optional controls default off.

---

# 3\) Deliverables by Version (no timelines)

- **v0.1**: CLI tool, JSON/CSV I/O, per-day plan \+ metrics, seed-deterministic heuristic solver, fixtures \+ regression skeleton.  
- **v0.2**: Locks/pins, mid-day re-opt, infeasibility advisor, best-so-far/progress.  
- **v0.3**: Score objective, daily caps & break, corridor/polygon, robustness+risk.  
- **v0.4**: Scenario save/compare, exclusion explainability.

---

# 4\) Glossary

- **Slack**: Day end buffer \= dayEnd − hotelETA.  
- **Feasible**: Start at day start, visit ordered stops with dwell, and reach hotel by dayEnd.  
- **Must-visit**: Store that must appear in the day’s path.  
- **Robustness factor**: Multiplier on travel time to simulate uncertainty.  
- **Corridor**: Polyline buffer or polygon within which candidates are allowed.

---

---

# 5\) Inputs & Mid-Day Re-Optimization (Task 2\)

This section specifies the data model and practical input pathways for v0.1, plus progressive additions for v0.2–v0.4. It also defines how we’ll operate **mid-day re-optimization** from a CLI without manual bookkeeping.

## 5.1 Minimal Inputs for v0.1 (MVP)

**Trip-level config**

- `mph` *(default 38\)*: constant speed used with Haversine to estimate travel time.  
- `defaultDwellMin` *(default 12\)*: fallback per-store dwell time.  
- `timeFormat` *(default "HH*\*:mm\*\*")\*: local time strings (ET for this trip).  
- `seed` *(default 1\)*: RNG seed for deterministic ties.  
- `snapDuplicateToleranceMeters` *(default 5\)*: exact-point dedupe threshold.

**Per-day configuration (**\`\`**)**

- `dayId`: e.g., `"2025-10-01"`.  
- `start`: `{ id, name, lat, lon }`.  
- `end`: `{ id, name, lat, lon }`.  
- `window`: `{ start: "09:00", end: "18:30" }`.  
- `mph` *(optional)*: overrides trip default per day.  
- `defaultDwellMin` *(optional)*: overrides trip default per day.  
- `mustVisitIds` *(optional)*: array of store IDs required that day.

**Candidate stores (per day or global list with \`\`)**

- `id` *(string, unique)*  
- `name` *(string)*  
- **Location** (see **5.3**): either `{lat,lon}` or one of the supported string forms that can be normalized to lat/lon.  
- `dwellMin` *(optional)*: default to `defaultDwellMin` if absent.  
- `score` *(reserved for v0.3; optional)*  
- `tags` *(optional)*

## 5.2 Optional Inputs by Version

**v0.2 – Usability & Resilience**

- **Locks/Pins (per day):**  
  - `{ storeId, position: "firstAfterStart" | "lastBeforeEnd" }`  
  - `{ storeId, index: number }` *(0 \= first after start anchor)*  
  - `{ storeId, afterStoreId }`  
- **Mid-day re-opt state** (see **5.5**):  
  - `currentTime` *(HH*\*:mm\*\*)\*  
  - `currentLocation` *({ lat, lon })* **or** `{ lastCompletedStoreId }`  
  - `completedStoreIds` *(optional)*  
- **Relaxation policy** for infeasibility advisor:  
  - `allowedRelaxations`: any of `["extendDay","reduceDwell","dropNonMust","unpinLocks","raiseMph"]`  
  - `limits` *(optional)*: e.g., `{ extendDayMaxMin: 30, reduceDwellMinPct: 10 }`  
- **Solver runtime knobs**: `timeLimitMs`, `maxIterations`, `multiStartSeeds`.

**v0.3 – Power Controls & Robustness**

- **Objective**: `objective` \= `"count" | "score" | "blend"`, `lambda` for blends.  
- **Daily caps/break**: `maxDriveMin`, `maxStops`, `break: { minDuration, window: { earliest, latest } }`  
- **Spatial filters** *(stretch; see **5.6**)*: `corridor` (LineString+buffer), `polygon` (Polygon), `excludeOutside`.  
- **Robustness**: `robustnessFactor` (e.g., 1.15) **or** `mphProfile`, plus `tightSlackThresholdMin` for risk reporting.

**v0.4 – Scenarios & Explainability**

- **Scenarios**: `scenarioId`, `scenarioName`, `compareAgainstScenarioId`.  
- **Explainability**: `explainDepth` (0–2), `altCandidatesCount` (default 3).

## 5.3 Location Acquisition & Normalization

The parser accepts multiple input forms and \*\*normalizes to `{lat,lon}`:

**Accepted \`\` forms**

1. **Decimal coordinates (preferred)** — `"42.4883,-83.1450"` or `{ "lat": 42.4883, "lon": -83.1450 }`.  
2. **Plus Codes (Open Location Code)**  
   - **Full** codes (e.g., `86JHGR6C+2Q`) → decode **offline** to lat/lon.  
   - **Short** codes (e.g., `GR6C+2Q Royal Oak, MI`) → require a **reference point** to resolve:  
     - Use the day’s **start anchor** as the reference. If the resolved point is implausible (\> \~30 km from the named locality center), fail with a clear error asking for a **full** Plus Code or lat/lon.  
3. **Google Maps URL (share link)**  
   - If the URL contains an `@lat,lon,zoom` tuple, extract lat/lon.  
   - If no `@` tuple is present, fail with guidance to provide a full Plus Code or lat/lon.

**Dependency:** Use Google’s open-source `open-location-code` library for Plus Codes.

**Minimal parser contract**

- If string matches `^-?\d+(\.\d+)?,-?\d+(\.\d+)?$` → parse coordinates.  
- Else if contains `'+'` → attempt Plus Code decode (full; or short \+ start-anchor reference).  
- Else if contains `'@<lat>,<lon>'` → extract and parse.  
- Else → **error**: “Provide lat/lon, a **full** Plus Code, or a Maps link containing `@lat,lon`.”

**Example \`\` (v0.1)**

{

  "id": "s\_103",

  "name": "Rusty Relics",

  "location": "86JHGR6C+2Q",

  "dwellMin": 12,

  "dayId": "2025-10-01"

}

## 5.4 Practical Ways to Get Coordinates from Google Maps

1. **Google My Maps (recommended)** — create a map, add stores, **Export → KML**, convert KML → CSV/JSON.  
2. **Google Takeout (Saved Places)** — export JSON, parse names & coordinates (filter to a list if needed).  
3. **Share Link Copy/Paste** — copy a link that includes `@lat,lon`. If absent, use a **full Plus Code** or copy the coordinates directly (“What’s here?”).

## 5.5 Mid-Day Re-Optimization: Inputs & Modes (v0.2)

To avoid manual “completed IDs” while driving, support three modes; the solver selects based on provided flags.

**Mode 1 — Schedule-based inference (zero overhead)**

- **Inputs:** `--now HH:mm`  
- **Logic:** Treat any stops with \*\*planned `depart ≤ now` as completed.

**Mode 2 — Location snap (recommended)**

- **Inputs:** `--now HH:mm --at "<lat>,<lon>"`  
- **Logic:** Snap `--at` to the nearest planned stop within radius **R** (default 120 m). Inside a stop → mark it current/completed; otherwise treat as in-transit.

**Mode 3 — Explicit completion (optional)**

- **Inputs:** `--completed s_103,s_212`  
- **Logic:** Respect explicit completions; combinable with Mode 2\.

**Fallback order:** Prefer Mode 2 if `--at` present, else Mode 3 if `--completed`, else Mode 1\.

**Additional flags:** `--time-limit-ms`, `--multi-start-seeds`, `--verbose`.

## 5.6 Spatial Filter (Corridor/Polygon) as Stretch (v0.3)

You can defer spatial filtering without impacting v0.1/v0.2. When enabled:

**Core spatial controls**

- **Corridor filter:** GeoJSON LineString \+ `bufferMeters`; include only stores within that buffer.  
- **Polygon filter:** GeoJSON Polygon; include only stores inside.  
- `excludeOutside` *(bool)*: when `true`, hard-prune out-of-bounds candidates pre-solve.

**Dependent features**

- Objective presets like **“Tight Corridor”** vs **“Aggressive Detours.”**  
- Explainability tag (v0.4): “Excluded: out-of-bounds (corridor/polygon).”  
- Scenario comparisons that vary corridor width.

## 5.7 Validation Rules & Defaults (recap)

- **IDs** unique per trip; anchors and stores must not collide.  
- **Coordinates:** `-90 ≤ lat ≤ 90`, `-180 ≤ lon ≤ 180`; no NaN/nulls.  
- **Times:** `window.start < window.end`; ET local.  
- **Must-visits:** must exist in that day’s candidate list; otherwise infeasible.  
- **Dwell:** default to `defaultDwellMin` if missing; must be ≥ 0\.  
- **Duplicates:** points within `snapDuplicateToleranceMeters` are deduped (exact only; no cluster logic).

## 5.8 I/O Examples (v0.1)

**Trip JSON**

{

  "config": {

    "mph": 38,

    "defaultDwellMin": 12,

    "seed": 7

  },

  "days": \[

    {

      "dayId": "2025-10-01",

      "start": {"id":"detroit","name":"Detroit Start","lat":42.3314,"lon":-83.0458},

      "end": {"id":"cle-hotel","name":"Cleveland Hotel","lat":41.4993,"lon":-81.6944},

      "window": {"start":"09:00","end":"18:30"},

      "mustVisitIds": \["s\_103","s\_212"\]

    },

    {

      "dayId": "2025-10-02",

      "start": {"id":"cle-hotel","name":"Cleveland Hotel","lat":41.4993,"lon":-81.6944},

      "end": {"id":"buf-hotel","name":"Buffalo Hotel","lat":42.8864,"lon":-78.8784},

      "window": {"start":"09:00","end":"18:00"}

    }

  \],

  "stores": \[

    {"id":"s\_103","name":"Rusty Relics","location":"86JHGR6C+2Q","dwellMin":12,"dayId":"2025-10-01"},

    {"id":"s\_212","name":"Lake Thrift","location":"41.5100,-81.6700","dayId":"2025-10-01"},

    {"id":"s\_310","name":"Erie Attic","location":"https://maps.google.com/.../@42.1200,-80.0800,17z","dwellMin":15,"dayId":"2025-10-02"}

  \]

}

**CLI (v0.1 / v0.2)**

node dist/index.js \\

  \--trip path/to/trip.json \\

  \--mph 38 \\

  \--default-dwell 12 \\

  \--seed 7 \\

  \--verbose

\# Mid-day re-opt (v0.2):

node dist/index.js \\

  \--trip path/to/trip.json \\

  \--day 2025-10-02 \\

  \--now "13:42" \\

  \--at "42.1234,-80.0123" \\

  \--time-limit-ms 4000

---

# 6\) Architecture & Algorithms (Task 3\)

## 6.1 Tech Stack & Project Skeleton

**Language:** TypeScript (Node.js).

/src

  /core

    cost.ts            // Haversine & time conversions, matrix

    types.ts           // All shared types

    schedule.ts        // Build timeline; feasibility & slack

    heuristics.ts      // Seed, insertion, 2-opt, relocate

    daySolver.ts       // Orchestrates a single-day solve

    reopt.ts           // Mid-day re-optimization (v0.2)

    infeasibility.ts   // Minimal relaxations (v0.2)

    spatial.ts         // Corridor/Polygon prefilter (v0.3)

    explain.ts         // Exclusions & swap analysis (v0.4)

  /io

    parse.ts           // Trip/stores parsing; parseLocation()

    emit.ts            // JSON/Markdown outputs

  /app

    solveDay.ts        // CLI entry for a day

    solveTrip.ts       // Multi-day partitioner

    config.ts          // Defaults, flags, validation

index.ts               // CLI router

/tests

  fixtures/\*\*          // Synthetic cases

  regression/\*\*        // Gold baselines

## 6.2 Core Types (v0.1-first; forward-compatible)

export type ID \= string;

export interface Coord { lat: number; lon: number; }

export interface Anchor { id: ID; name: string; lat: number; lon: number; }

export interface Store {

  id: ID;

  name: string;

  lat: number; lon: number;

  dwellMin?: number;

  score?: number;  // v0.3

  tags?: string\[\];

  dayId?: string;  // when using a global list

}

export interface DayConfig {

  dayId: string;

  start: Anchor;

  end: Anchor;

  window: { start: string; end: string }; // "HH:mm"

  mph?: number;

  defaultDwellMin?: number;

  mustVisitIds?: ID\[\];

  locks?: LockSpec\[\]; // v0.2+

}

export type LockSpec \=

  | { storeId: ID; position: "firstAfterStart" | "lastBeforeEnd" }

  | { storeId: ID; index: number }

  | { storeId: ID; afterStoreId: ID };

export interface TripConfig {

  mph?: number;

  defaultDwellMin?: number;

  seed?: number;

  snapDuplicateToleranceMeters?: number;

}

export interface TripInput { config: TripConfig; days: DayConfig\[\]; stores: Store\[\]; }

export interface Leg { fromId: ID; toId: ID; driveMin: number; distanceMi: number; }

export interface StopPlan { id: ID; type: "start" | "store" | "end"; arrive: string; depart: string; dwellMin?: number; legIn?: Leg; }

export interface DayPlan {

  dayId: string;

  stops: StopPlan\[\];

  metrics: { storesVisited: number; totalDriveMin: number; totalDwellMin: number; slackMin: number; };

}

## 6.3 Cost & Time Engine

export function haversineMi(a: Coord, b: Coord): number { /\* great-circle \*/ }

export function minutesAtMph(distanceMi: number, mph: number): number { return (distanceMi / mph) \* 60; }

export interface CostMatrix { ids: ID\[\]; distanceMi: number\[\]\[\]; driveMin: number\[\]\[\]; }

export function buildMatrix(ids: ID\[\], idToCoord: Record\<ID, Coord\>, mph: number): CostMatrix { /\* O(n^2) \*/ }

## 6.4 Schedule Builder & Feasibility

**Insertion delta:** `Δtime = drive(i,u) + dwell(u) + drive(u,j) - drive(i,j)`; feasible if hotel ETA ≤ dayEnd.

export function computeTimeline(order: ID\[\], ctx: ScheduleCtx): { stops: StopPlan\[\]; totalDriveMin: number; totalDwellMin: number; hotelETAmin: number; }

export function isFeasible(order: ID\[\], ctx: ScheduleCtx): boolean

export function slackMin(order: ID\[\], ctx: ScheduleCtx): number

## 6.5 Day Solver (v0.1)

- Must-visit seed → greedy insert (min feasible Δtime) → local search (2-opt \+ relocate) with tie-breakers.  
- Tie-breakers: maximize end slack → minimize total drive.  
- Deterministic via seeded RNG.

## 6.6 Mid-Day Re-Optimization (v0.2)

- Modes: **schedule-based**, **location snap** (recommended), **explicit completed IDs**.  
- Build residual day from `now` and `atCoord`; keep hotel and remaining locks.  
- Infeasibility advisor suggests minimal relaxations.

## 6.7 Spatial Filters (v0.3)

- Optional pre-solve pruning: corridor/ polygon; hard-prune when `excludeOutside=true`.

## 6.8 Robustness & Objectives (v0.3)

- `robustnessFactor` inflates travel time; compute **On-Time Risk**.  
- Objective variants: `count` | `score` | `blend`.

## 6.9 Explainability & Scenarios (v0.4)

- Explain exclusions; suggest nearest swap.  
- Save & compare scenarios; report KPI deltas.

## 6.10 Parsing & Validation (I/O)

- `parseTrip()` merges JSON/CSV and validates.  
- `parseLocation()` handles lat/lon, Plus Codes (via `open-location-code`), and Maps URL `@lat,lon` extraction.

## 6.11 CLI Surface

- v0.1: `solve-day --trip trip.json --day 2025-10-01 --mph 38 --default-dwell 12 --seed 7`  
- v0.2 re-opt: `solve-day --trip trip.json --day 2025-10-02 --now 13:42 --at "42.1234,-80.0123"`

## 6.12 Determinism & Tie Handling

- Single seeded RNG; lexicographic comparator over Δtime ↑, slack ↓, drive ↑, RNG tie.

## 6.13 Performance Targets & Tuning

- ≤ 2–5s for \~300 candidates/day; matrix caching; `timeLimitMs`, `multiStartSeeds`.

## 6.14 Testing Plan

- Unit: haversine, matrix symmetry, timeline monotonicity, determinism.  
- Fixtures: clustered vs scattered; far must-visit.  
- Property: random fields under fixed seed.  
- Regression: gold JSON day plans.

## 6.15 Extension Points Map

- v0.1: `solveDay`, `computeTimeline`, `buildMatrix`, `parseLocation`.  
- v0.2: `reoptimizeDay`, `infeasibility`, locks handling.  
- v0.3: `objective`, `spatial`, `robustnessFactor`, `onTimeRisk`.  
- v0.4: `explain`, `scenarios`.

---

# 7\) Units Decision (v0.x) — Imperial Only

**Decision:** Drop metric support in v0.x. All internal/external distances are **miles**, speeds are **mph**, and durations are **minutes**.

**Why:** Simplifies config, code paths, tests, and docs; matches US driving intuition. No geodesic/routing accuracy is lost for v0.x since we use Haversine × mph.

## Scope of Change

- **Config:** Remove `config.units`. Keep `config.mph` (default **38**).  
- **Engine:** `haversineMi()` returns miles; `minutesAtMph(distanceMi, mph)` returns minutes. No unit switches or conversions.  
- **I/O & Output:** Distances reported in miles; durations in minutes; times as `HH:mm`.  
- **Docs & Examples:** Update JSON examples to drop the `units` field.  
- **Tests:** Remove metric-specific cases.

## Code Touches

- `types.ts`: `TripConfig` — remove `units?: "imperial" | "metric";`  
- `cost.ts`: ensure function names/sigs are MI-anchored (`haversineMi`, `minutesAtMph`).  
- `parse.ts`: no unit branching.  
- `emit.ts`: label units in summaries (e.g., `totalDriveMin`, `distanceMi`).

## Updated v0.1 Trip JSON Example (units removed)

{

  "config": {

    "mph": 38,

    "defaultDwellMin": 12,

    "seed": 7

  },

  "days": \[

    {

      "dayId": "2025-10-01",

      "start": {"id":"detroit","name":"Detroit Start","lat":42.3314,"lon":-83.0458},

      "end": {"id":"cle-hotel","name":"Cleveland Hotel","lat":41.4993,"lon":-81.6944},

      "window": {"start":"09:00","end":"18:30"},

      "mustVisitIds": \["s\_103","s\_212"\]

    },

    {

      "dayId": "2025-10-02",

      "start": {"id":"cle-hotel","name":"Cleveland Hotel","lat":41.4993,"lon":-81.6944},

      "end": {"id":"buf-hotel","name":"Buffalo Hotel","lat":42.8864,"lon":-78.8784},

      "window": {"start":"09:00","end":"18:00"}

    }

  \],

  "stores": \[

    {"id":"s\_103","name":"Rusty Relics","location":"86JHGR6C+2Q","dwellMin":12,"dayId":"2025-10-01"},

    {"id":"s\_212","name":"Lake Thrift","location":"41.5100,-81.6700","dayId":"2025-10-01"},

    {"id":"s\_310","name":"Erie Attic","location":"https://maps.google.com/.../@42.1200,-80.0800,17z","dwellMin":15,"dayId":"2025-10-02"}

  \]

}

## Future Re-introduction (if ever needed)

If metric is required later, gate it behind a single `units` flag and convert **once** at input load:

- Normalize all incoming distances to **miles** (or adopt SI internally and convert on emit).  
- Keep solver & heuristics unit-agnostic.

---

# 8\) v0.1 Engineer Handoff Checklist

**Goal:** Enable the coding AI/engineer to implement and ship the MVP quickly and deterministically.

## A. Dependencies

- **Runtime:** `commander`, `seedrandom`, `open-location-code`  
- **Dev:** `typescript`, `tsx` *(or **`ts-node`**)*, `eslint` \+ `@typescript-eslint/*`, `prettier`  
- **Tests:** `vitest` *(or **`jest`**)*  
- **Optional (import helpers):** `fast-xml-parser` *(for simple KML → JSON)*

## B. NPM Scripts (suggested)

{

  "scripts": {

    "build": "tsc \-p .",

    "dev": "tsx src/index.ts",

    "test": "vitest run",

    "lint": "eslint . \--ext .ts"

  }

}

## C. Implement First (file order)

1. `/src/core/cost.ts` — `haversineMi`, `minutesAtMph`, `buildMatrix()`  
2. `/src/core/types.ts` — types in §6.2 (imperial-only)  
3. `/src/core/schedule.ts` — `computeTimeline`, `isFeasible`, `slackMin`  
4. `/src/core/heuristics.ts` — seed → greedy insert (min feasible Δtime) → 2-opt/relocate; seeded tie-breaks  
5. `/src/io/parse.ts` — `parseTrip`, `parseLocation` (lat/lon | Plus Code | URL `@lat,lon`), validation & dedupe  
6. `/src/io/emit.ts` — JSON \+ optional Markdown summary with per-day metrics  
7. `/src/app/solveDay.ts` — orchestrate a single day solve  
8. `/src/index.ts` — CLI entry (Commander): flags below

## D. CLI (v0.1)

solve-day \\

  \--trip path/to/trip.json \\

  \--day 2025-10-01 \\

  \--mph 38 \\

  \--default-dwell 12 \\

  \--seed 7 \\

  \--verbose

## E. Tests & Fixtures

- **Unit:**  
  - Haversine symmetry & sanity  
  - `computeTimeline` monotonic times; no negative slack  
  - `isFeasible` respects day end; must-visits present  
  - Determinism under fixed seed (identical plan twice)  
- **Fixtures:**  
  - **Clustered vs. scattered** candidates → cluster chosen more often  
  - **Far must-visit** → reduces store count predictably  
- **Performance harness:** 100–300 candidates with fixed seed finishes in target time

## F. Logging & Debug

- `--verbose` prints: inserted store id, position, Δtime; accepted 2-opt/relocate moves; final tie-break reason  
- On infeasible input: emit *why* (e.g., must-visit chain time \> window) and suggest the smallest change (extend window, reduce dwell, drop a candidate) — minimal version acceptable in v0.1

## G. Definition of Done (v0.1)

- Produces per-day plan with **arrivals/departs**, **drive**, **dwell**, **slack**, **hotel ETA**  
- Includes all **must-visits** or returns **infeasible** with a clear reason  
- Deterministic with a fixed seed  
- Handles \~**300 candidates/day** on a laptop in reasonable time

## H. Nice-to-Haves (do not block v0.1)

- KML import helper (`--kml mymap.kml`) → convert to stores JSON  
- Markdown export for human-readable itinerary  
- Basic progress indicator for greedy/2-opt passes

