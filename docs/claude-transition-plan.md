# Claude Transition Plan

*Prepared by Claude (Sonnet 4.6) · March 2026*

This document captures an initial assessment of the Rustbelt project — its architecture, implementation state, and technical debt — as part of a handoff to Claude as the primary development agent. It is intended to serve as both a reference and a living roadmap that can be updated as open questions are resolved.

---

## Prioritized Implementation Roadmap

### Open Questions That Drive Roadmap Direction

The issues identified in this assessment span from small technical fixes to significant roadmap decisions. Several of them cannot be prioritized correctly without answers to the following questions:

**Q1 — What is the primary usage mode today?**
Is the user running Atlas → Solver as a connected pipeline for each trip, or are Atlas scores computed infrequently (e.g., monthly) and the solver run daily against stable scores? The answer determines whether pipeline glue automation is urgent or just convenient.

**Q2 — How many stores are in the active DB, and how many metros?**
If the corpus is small (< 200 stores, 1–2 metros), the Euclidean kNN approximation in Atlas is unlikely to cause real problems. If it grows to 500+ stores across a wider geographic spread, the correctness issue becomes more material.

**Q3 — Is the `dayOfApp` being used in the field?**
The Bayesian multi-armed bandit "stay or leave" feature exists in the solver package but its integration path is unclear. If it is actively used, it should be treated as a first-class feature with proper CLI exposure. If it isn't, it's a candidate for extraction or deferral.

**Q4 — Is the plan to keep Atlas in Python long-term?**
The tech plan mentions a potential TypeScript port of Atlas once the models stabilize. Choosing to stay with Python affects decisions about dependency scope (e.g., whether to bring in scipy/statsmodels), CI complexity, and where the pipeline glue lives.

**Q5 — What is the canonical store type taxonomy?**
The storedb and Atlas prior use different type vocabularies with no normalization layer. Is the storedb taxonomy the source of truth, or the Atlas one? Resolving this determines whether the DB needs migration, Atlas needs new type definitions, or a mapping layer should be introduced.

**Q6 — Is multi-window store hours a real requirement?**
The solver supports multiple open/close windows per day. The storedb schema supports only one. Are there stores in the corpus that are genuinely closed mid-day? If so, the schema needs to be extended before hours data is useful in solver runs.

---

### Tier 1 — Fix Now (Correctness and Usability Blockers)

These are either bugs, data quality issues, or gaps that make the system harder to use than it should be for its current purpose.

| # | Issue | Why Now |
|---|---|---|
| 1.1 | **Pipeline glue script** (storedb export → Atlas score → trip JSON merge) | Nothing connects the pieces. Users must manually handle CSV files. This is the biggest day-to-day friction point. |
| 1.2 | **Store type normalization** | Types like `Nautical`, `Junk`, `Boutique`, `Furniture` silently map to `Unknown` in Atlas, degrading prior score quality for a meaningful slice of the corpus. |
| 1.3 | **Haversine in kNN spatial smoothing** (`posterior.py`) | `_knn_smooth_sparse_predictions` uses Euclidean distance on decimal degrees. This is a correctness bug for east-west neighbors. Easy fix. |
| 1.4 | **Store hours export utility** (DB minutes → solver HH:mm format) | Without this, open hours data in storedb cannot flow into solver runs. Anyone building the pipeline hits this and re-implements it. |

---

### Tier 2 — Next Sprint (Simplification Without Regression Risk)

These reduce maintenance cost or technical debt without requiring architectural decisions.

| # | Issue | Notes |
|---|---|---|
| 2.1 | **Score injection utility** — merge Atlas `scored-stores.csv` into trip JSON `score` field | The solver's `lambda`-blend objective is wired up but has no data feed. A small CLI helper closes this loop. |
| 2.2 | **dayOfApp — decide and document** | Either wire it into the main CLI with a proper `--day-of` flag, or extract it to a separate entry point. Its current location in `src/io/dayOfApp/` is ambiguous. |
| 2.3 | **Update docs roadmap to reflect actual v0.2 implementation state** | Several v0.2 features (locks, reoptimizeDay, infeasibility advisor, break window) are implemented but the docs still mark them "in progress." This creates false impressions of project maturity. |
| 2.4 | **Makefile or top-level run script** | The tech plan describes `make atlas-test` / `make solver-build` targets. They don't exist. Even a thin shell script adds clarity for new contributors. |

---

### Tier 3 — Architectural Decisions (Resolve After Q1–Q6 Above)

These require answers to the open questions before committing to an approach.

| # | Issue | Depends On |
|---|---|---|
| 3.1 | **Replace scratch IRLS with scipy/statsmodels** | Q4 (Python long-term?). If yes, adopt the library. Removes ~300 lines of custom GLM math. |
| 3.2 | **Resolve storedb store type taxonomy** | Q5. Either extend Atlas `TYPE_BASELINES`, add a mapping dict, or migrate the DB. |
| 3.3 | **Multi-window store hours in storedb** | Q6. If real, the `store_hours` table needs a redesign (one row per window, not per day). |
| 3.4 | **Coord type unification in Solver** | Low urgency but the tuple `[lat, lon]` vs object `{ lat, lon }` split is a latent footgun. Consider standardizing on `{ lat, lon }` throughout TS internals. |
| 3.5 | **dayOfApp scoping** | Q3. The answer to whether it's being used determines whether it gets promoted or isolated. |

---

### Tier 4 — Roadmap Items (Already Documented, No New Decisions Needed)

These are already in the implementation plan and are not blocked. Listed here for completeness and sequencing context.

- **v0.3 Solver** — Score/blend objective mode (lambda), spatial corridor/polygon filter, robustness+risk reporting (type scaffolding already in codebase)
- **v0.3 Atlas** — Sub-cluster refinement, refined affluence model, Solver-compatible candidate set output
- **v0.4 Solver** — Scenario save/compare, exclusion explainability (why-excluded + nearest swap)
- **Atlas TypeScript parity evaluation** — Per tech plan Phase 4; deferred until Python models stabilize

---

## Project Assessment

### What It Is

A two-component system for planning multi-day thrift store road trips:

- **Solver** (`packages/solver-cli`, TypeScript) — orienteering-style route optimizer: greedy insertion → 2-opt → relocate local search, with constraint handling for must-visits, locks, open hours, break windows, and robustness factor.
- **Atlas** (`packages/atlas-python`, Python) — store scoring engine: Value/Yield model with prior (store type + ZIP affluence) + posterior (GLM/IRLS + ECDF ranking), DBSCAN clustering, and trace explainability.

Connected by versioned CSV/JSON schemas (`/schema/atlas/v1/`), a SQLite store database (`storedb/`), and file exchange.

---

### Implementation State vs. Docs

**The Solver is further along than the roadmap suggests.**

| Version | Documented As | Actual State |
|---|---|---|
| v0.1 | MVP ✅ | Fully implemented |
| v0.2 | In Progress | Largely complete — locks, reoptimizeDay, infeasibility advisor, break window all present and tested |
| v0.3 | Planned | Partially in — `robustnessFactor`, `maxDriveTime`, `maxStops`, and `lambda` objective are all present in types and heuristics |
| v0.4 | Stretch | Not started |

**Atlas is solid for a Python prototype:**
- Prior scoring (type baselines + affluence adjustments + kNN adjacency) — complete
- Posterior pipeline (IRLS GLM, overdispersion detection, ECDF ranking, shrinkage blending) — complete, implemented in ~700 lines of scratch numpy math
- DBSCAN anchors + sub-clusters — complete
- Trace/explainability — complete and baked into the scoring pipeline from the start (good foresight)

**Test coverage is respectable.** 20+ test files in the solver covering heuristics, schedule, parse, locks, re-opt, infeasibility, store hours, day-of app, and KML/HTML emit. Atlas has fixture-based tests for dense urban vs. sparse rural scenarios.

---

### Architecture Strengths

**1. Clean Atlas ↔ Solver boundary.**
The two systems are genuinely decoupled. File exchange via versioned JSON Schema is the right approach. No runtime cross-language coupling exists or is planned.

**2. Documentation quality.**
Unusually thorough and kept in sync with code. The implementation plan, FR versioning, and CLI references are accurate. The V/Y whitepaper, algorithm reference, and CLI docs give a new contributor a real onboarding path.

**3. Determinism by default.**
Seeded RNG throughout the solver. Essential for debugging and regression testing. The `seed` parameter is first-class in both config and CLI.

**4. Feasibility model is well-structured.**
The `assessFeasibility` / `FeasibilityReason` discriminated union in `schedule.ts` surfaces actionable constraint violations (day window, max drive, break window, store closed, max stops) in a way that downstream code can reason about, not just display.

**5. Trace explainability in Atlas.**
Built into the scoring pipeline from the start rather than retrofitted. The `TraceRecord` → JSONL path enables auditability and future UI development without changes to the core model.

**6. Monorepo layout.**
The `/packages` + `/schema` layout matches the documented tech plan. The separation between `atlas-python` (pip) and `solver-cli` (npm) correctly isolates toolchains.

---

### Issues

#### Issue 1 — Missing end-to-end pipeline glue (biggest gap)

There is no automated path from storedb → Atlas → Solver. A user must manually:
1. Export CSVs from SQLite
2. Run the Atlas CLI
3. Merge `scored-stores.csv` back into trip JSON (no tool exists for this step)

The Makefile described in the tech plan does not exist. This is the most significant operational gap.

#### Issue 2 — Store type taxonomy mismatch

The storedb `store_type` column contains: `Antique`, `Thrift`, `Surplus`, `Vintage`, `Nautical`, `Flea`, `Junk`, `Boutique`, `Furniture`, `Sports`, `Discount`.

Atlas `TYPE_BASELINES` knows: `Thrift`, `Antique`, `Vintage`, `Flea/Surplus`, `Unknown`.

Types like `Nautical`, `Junk`, `Boutique`, `Furniture`, `Sports`, `Discount` all silently fall through to `Unknown` during prior scoring. No normalization layer or mapping dict exists. This is a data quality issue that affects scoring for a meaningful portion of stores.

#### Issue 3 — Euclidean distance in kNN spatial smoothing

In `packages/atlas-python/src/atlas/scoring/posterior.py`, `_knn_smooth_sparse_predictions` computes neighbor distances as:

```python
distances = np.sqrt(np.sum((anchor_coords - coords[idx]) ** 2, axis=1))
```

This is Euclidean on decimal degrees. At the geographic scale of the Rust Belt (roughly 5° latitude × 10° longitude), 1° of latitude ≈ 69 miles and 1° of longitude ≈ 50 miles. The resulting distance matrix is distorted, particularly east-west, and will bias spatial smoothing toward geographically incorrect neighbors. Haversine (or a simple degree-to-approximate-miles conversion) should be used instead.

#### Issue 4 — Score injection not wired up

The solver's `Store.score` field feeds the `lambda`-blend objective (`λ·score + (1-λ)·count`). Atlas produces a `Composite` score in `scored-stores.csv`. No utility exists to merge those scores into a trip JSON `stores` array. The objective mode is implemented end-to-end in the solver but has no data feed from Atlas in practice.

#### Issue 5 — Atlas IRLS implemented from scratch

The posterior pipeline implements iteratively re-weighted least squares (Poisson and Negative-Binomial GLM) entirely in numpy — approximately 300 lines of custom solver code. The documented rationale is keeping the dependency footprint light. In practice, `scipy` is already a transitive dependency of the numpy/pandas ecosystem, and `statsmodels.api.GLM` would replace this with well-validated library code. The custom IRLS is harder to audit and extend. This is a maintenance cost vs. dependency scope tradeoff that warrants a deliberate decision.

#### Issue 6 — dayOfApp scope is ambiguous

`packages/solver-cli/src/io/dayOfApp/` implements a Bayesian multi-armed bandit "stay or leave" decision system. It has its own state management, recommendation engine, and posterior update logic. It is tested but:
- Its CLI entry point is not clearly documented in the main CLI reference
- Its relationship to the main `solve-day` workflow is not defined
- It adds meaningful complexity to a package whose primary purpose is route planning

It should either be wired into the main CLI as a first-class subcommand, or extracted as a standalone entry point.

#### Issue 7 — Store hours format gap between storedb and Solver

- `storedb.store_hours` stores hours as `open_min` / `close_min` (integer minutes since midnight) with `day_of_week` as an integer (0 = Mon, 6 = Sun).
- The solver's `StoreOpenHours` type uses string weekday keys (`wed`, `thu`, etc.) and HH:mm string pairs.

No conversion script or shared utility exists to bridge these representations. Anyone building the pipeline export will re-implement this translation.

#### Issue 8 — storedb supports only single open/close window per day

The `store_hours` table has a `PRIMARY KEY (store_id, day_of_week)` constraint, meaning one row per store per weekday. The solver's `StoreOpenHours` is typed as `[string, string][]` (an array of windows), supporting stores with mid-day closures. If any stores in the corpus have split hours, this is a schema limitation that would silently drop that information.

#### Issue 9 — Coord representation inconsistency in Solver

- `Anchor.coord` and `Store.coord` are `readonly [number, number]` tuples internally
- `StopPlan` emits `lat: number; lon: number` as separate named fields in output
- Trip JSON schema and all docs use `{ lat, lon }` object form

The tuple convention relies on remembering that index 0 = lat and index 1 = lon. Nothing in the type system enforces this. It is not a current bug, but it is a latent source of silent lat/lon swap errors, particularly for contributors working from the JSON schema documentation.

#### Issue 10 — Docs roadmap does not reflect actual implementation state

Several v0.2 features — locks, reoptimizeDay, infeasibility advisor, break window — are implemented and tested but the implementation doc still marks v0.2 as "In Progress." The roadmap table in `route-planner-implementation.md` should be updated to reflect what has actually shipped. This matters for onboarding and for scoping what remains to be done in v0.3.

---

### Simplification Opportunities

| Opportunity | Effort | Impact | Notes |
|---|---|---|---|
| Pipeline glue script | Small | High | Shell script or Makefile target connecting storedb → Atlas → trip JSON |
| Store type normalization dict | Trivial | Medium | A mapping from storedb types to Atlas type keys prevents silent `Unknown` fallthrough |
| Haversine in kNN (`posterior.py`) | Trivial | Medium | Correctness fix; use `math.radians` + Haversine or approximate degrees → miles |
| Score injection CLI utility | Small | High | Merge Atlas `scored-stores.csv` into trip JSON `score` fields |
| Hours export utility | Small | Medium | DB minutes + day_of_week integer → solver `StoreOpenHours` HH:mm format |
| Replace scratch IRLS with scipy | Medium | Medium | Removes ~300 lines of custom GLM math; depends on Python long-term decision |
| dayOfApp: extract or integrate | Small | Low-Medium | Reduces package scope ambiguity |
| Update roadmap docs to reflect v0.2 completion | Trivial | Low | Maintenance hygiene |

---

### Takeover Readiness Summary

**Strengths:**
- Code is clean, well-structured, and closely matches its documentation
- Test suite provides reasonable regression protection across both components
- Architecture decisions are sound and clearly explained in the docs
- Atlas's mathematical design (V/Y model, shrinkage, ECDF) is well-reasoned and documented
- The Solver is more complete than the docs suggest — less work remaining than it looks

**Gaps:**
- No automated end-to-end pipeline from storedb → Atlas → Solver
- Store type taxonomy divergence between storedb and Atlas causes silent scoring degradation
- Euclidean kNN approximation in `posterior.py` is a correctness issue for geographic smoothing
- The `dayOfApp` feature is ambiguously scoped within the solver package
- No hours conversion utility means open hours data in the DB cannot flow into solver runs without manual work

**Bottom line:** This is a well-designed project past the prototype stage in both components. The primary readiness gap is not algorithm quality or code structure — it is the **operational pipeline** connecting the pieces. Resolving Tier 1 issues above and answering the six open questions would put the project in a strong position for the v0.3 development cycle.
