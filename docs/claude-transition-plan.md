# Claude Transition Plan

*Prepared by Claude (Sonnet 4.6) · March 2026*

This document captures an initial assessment of the Rustbelt project — its architecture, implementation state, and technical debt — as part of a handoff to Claude as the primary development agent. It is intended to serve as both a reference and a living roadmap that can be updated as open questions are resolved.

---

## Prioritized Implementation Roadmap

### Resolved Questions

The following questions were posed in the initial assessment and have been answered. Decisions are reflected in the tiers below.

**Q1 — Primary usage mode** *(answered)*
The Atlas → Solver pipeline is not being used end-to-end today. The primary mode is the **local trip**: a list of nearby stores, run through Atlas, with outputs observed directly to decide which 1–2 stores to visit. Solver is nominally available but the Atlas → Solver handoff is too rough to use in practice. The goal is to smooth that path. An upcoming Florida trip will exercise the local trip model immediately.

*Decision: Pipeline glue is the top priority. Score injection into the solver is the next logical step after that.*

**Q2 — Corpus size** *(answered)*
~300 stores across 5–7 metros and growing. The kNN Euclidean approximation is not a problem in the local trip model (short distances, same metro). It becomes a real issue in the road trip model (5-day trips spanning multiple metros). The kNN fix is real but not urgent ahead of pipeline work.

*Decision: Haversine fix moves to Tier 2. Pipeline glue is unambiguously first.*

**Q3 — dayOfApp usage** *(answered)*
`dayOfApp` was built for a single 5-day road trip prototype. It is not in active use. It was an interesting experiment and the Bayesian bandit approach has merit conceptually, but it should not receive further investment at this stage. The lessons it encodes — real-time stay/leave updating, posterior-driven decisions — are worth noting for a future first-class in-trip app experience.

*Decision: Defer. Archive the concept; no new feature work.*

**Q4 — Python vs. TypeScript for Atlas** *(answered)*
Python stays for the foreseeable future. The modeling work is not done and Python has the libraries and flexibility to continue it. A TypeScript port is speculative generality until the models stabilize and a web or mobile front-end becomes a concrete near-term goal. There is no irreversible proposition here.

*Decision: Defer TypeScript port entirely. Python commitment unblocks the scipy/statsmodels decision (Q4 → resolve Issue 5).*

**Q5 — Store type taxonomy** *(answered)*
The storedb taxonomy is intentionally expansive and should stay that way as a data capture layer. Atlas should enforce a narrower, validated set **at ingestion time** — not by constraining what the DB stores. Types like `Nautical`, `Boutique`, `Furniture`, `Sports`, `Discount` are too small a share of the corpus to model distinctly and should map to a fallback at the Atlas boundary. The real consolidation needed is:
- `Junk` → `Thrift` (functionally equivalent)
- `Antique` and `Vintage` → likely the same model (to be confirmed with a data review; not tonight)
- `Surplus` and `Flea` → already in Atlas as `Flea/Surplus`

*Decision: Add an explicit ingestion-time mapping dict in Atlas. Do not migrate the DB. Data review for Antique/Vintage model consolidation is a follow-on task.*

**Q6 — Multi-window store hours** *(answered)*
Single window per day is the right level of fidelity for now. Stores with unusual split hours are outliers and the schema captures the common case correctly. The solver already supports multi-window but there is no urgency to extend the DB to match. This is a no-harm, no-cost status quo.

*Decision: No action. Leave both schema and solver as-is.*

---

### Tier 1 — Do Now (Unblocks the Florida Trip and the Local → Road Trip Pipeline)

| # | Issue | Why Now |
|---|---|---|
| 1.1 | **Atlas → Solver pipeline glue** | The biggest day-to-day friction point. Nothing connects storedb export → Atlas score → trip JSON. A thin script or Makefile target unblocks the full end-to-end flow. |
| 1.2 | **Score injection utility** | Merges Atlas `scored-stores.csv` into trip JSON `score` fields. The solver's λ-blend objective is wired up and waiting for this data feed. Required to make the pipeline actually useful. |
| 1.3 | **Atlas ingestion type normalization** | Add an explicit mapping dict at the Atlas ingestion boundary: `Junk → Thrift`, `Surplus/Flea → Flea/Surplus`, `Nautical/Boutique/Furniture/Sports/Discount → Unknown` (explicit, not silent). Follow-on: confirm whether `Antique` and `Vintage` should share a model. |
| 1.4 | **Update docs roadmap to reflect v0.2 completion** | v0.2 features are shipped and tested. The "in progress" markers create a false picture of where the project stands. Quick and low-risk. |

---

### Tier 2 — Next Sprint (Correctness and Operational Maturity)

| # | Issue | Notes |
|---|---|---|
| 2.1 | **Haversine in kNN spatial smoothing** (`posterior.py`) | Not urgent for local trips but a real correctness issue across metros on road trips. Easy fix once pipeline work is done. |
| 2.2 | **Store hours export utility** | Bridges DB `open_min`/`close_min` integer format to solver `StoreOpenHours` HH:mm format. Needed once the pipeline is running and hours data should feed into solver constraints. |
| 2.3 | **Replace scratch IRLS with scipy/statsmodels** | Python is staying, so this is now unblocked. Removes ~300 lines of custom GLM math in favor of well-validated library code. Medium effort; schedule when modeling work has a pause. |
| 2.4 | **Makefile or top-level run script** | Described in the tech plan; does not exist. Adds reproducibility and lowers the barrier for running the full stack. |

---

### Tier 3 — Deferred (No Action Unless Circumstances Change)

| # | Issue | Rationale |
|---|---|---|
| 3.1 | **dayOfApp — archive and document** | Prototype only; no further investment. Document the bandit concept and lessons in a design note for a future in-trip app. Do not wire into main CLI. |
| 3.2 | **Antique/Vintage model consolidation** | Likely the same model, but needs a data review before acting. Low urgency. |
| 3.3 | **Coord type unification in Solver** | Latent footgun (tuple vs. object), but not a current bug. Defer unless there is a related refactor in the area. |
| 3.4 | **Multi-window store hours** | Confirmed no-action. Single window per day is correct for the corpus. |
| 3.5 | **Atlas TypeScript port** | Speculative generality. No concrete trigger to revisit. |

---

### Tier 4 — Existing Roadmap Items (No New Decisions Needed)

These are already in the implementation plan and sequencing is unchanged.

- **v0.3 Solver** — Score/blend objective mode (lambda), spatial corridor/polygon filter, robustness+risk reporting
- **v0.3 Atlas** — Sub-cluster refinement, refined affluence model, Solver-compatible candidate set output
- **v0.4 Solver** — Scenario save/compare, exclusion explainability (why-excluded + nearest swap)

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

Types like `Nautical`, `Junk`, `Boutique`, `Furniture`, `Sports`, `Discount` all silently fall through to `Unknown` during prior scoring. No normalization layer or mapping dict exists.

**Resolution (per Q5):** The storedb taxonomy is intentionally broad and should not be constrained. The fix belongs at the Atlas ingestion boundary: an explicit mapping dict (`Junk → Thrift`, `Surplus → Flea/Surplus`, small/uncommon types → explicit `Unknown`). The DB does not need migration. Whether `Antique` and `Vintage` should share a single model is a follow-on data review task.

#### Issue 3 — Euclidean distance in kNN spatial smoothing

In `packages/atlas-python/src/atlas/scoring/posterior.py`, `_knn_smooth_sparse_predictions` computes neighbor distances as:

```python
distances = np.sqrt(np.sum((anchor_coords - coords[idx]) ** 2, axis=1))
```

This is Euclidean on decimal degrees. At the geographic scale of the Rust Belt (roughly 5° latitude × 10° longitude), 1° of latitude ≈ 69 miles and 1° of longitude ≈ 50 miles. The resulting distance matrix is distorted, particularly east-west, and will bias spatial smoothing toward geographically incorrect neighbors. Haversine (or a simple degree-to-approximate-miles conversion) should be used instead.

**Resolution (per Q2):** Not urgent for the local trip model — within a single metro the distortion is small. This becomes a real correctness concern on road trip runs spanning multiple metros. Scheduled for Tier 2 after pipeline work is done.

#### Issue 4 — Score injection not wired up

The solver's `Store.score` field feeds the `lambda`-blend objective (`λ·score + (1-λ)·count`). Atlas produces a `Composite` score in `scored-stores.csv`. No utility exists to merge those scores into a trip JSON `stores` array. The objective mode is implemented end-to-end in the solver but has no data feed from Atlas in practice.

#### Issue 5 — Atlas IRLS implemented from scratch

The posterior pipeline implements iteratively re-weighted least squares (Poisson and Negative-Binomial GLM) entirely in numpy — approximately 300 lines of custom solver code. The documented rationale is keeping the dependency footprint light. In practice, `scipy` is already a transitive dependency of the numpy/pandas ecosystem, and `statsmodels.api.GLM` would replace this with well-validated library code. The custom IRLS is harder to audit and extend.

**Resolution (per Q4):** Python is staying, so the dependency scope concern is moot. Replacing the scratch IRLS with `statsmodels` is now unblocked. Scheduled for Tier 2 — medium effort, low urgency relative to pipeline work.

#### Issue 6 — dayOfApp scope is ambiguous

`packages/solver-cli/src/io/dayOfApp/` implements a Bayesian multi-armed bandit "stay or leave" decision system. It has its own state management, recommendation engine, and posterior update logic. It is tested but:
- Its CLI entry point is not clearly documented in the main CLI reference
- Its relationship to the main `solve-day` workflow is not defined
- It adds meaningful complexity to a package whose primary purpose is route planning

**Resolution (per Q3):** This was a prototype for a single road trip and is not in active use. No further investment. The Bayesian bandit approach — real-time stay/leave recommendations updating a posterior over store visit value — is a sound concept worth revisiting when an in-trip app experience becomes a first-class goal. Defer.

#### Issue 7 — Store hours format gap between storedb and Solver

- `storedb.store_hours` stores hours as `open_min` / `close_min` (integer minutes since midnight) with `day_of_week` as an integer (0 = Mon, 6 = Sun).
- The solver's `StoreOpenHours` type uses string weekday keys (`wed`, `thu`, etc.) and HH:mm string pairs.

No conversion script or shared utility exists to bridge these representations. Anyone building the pipeline export will re-implement this translation.

#### Issue 8 — storedb supports only single open/close window per day

The `store_hours` table has a `PRIMARY KEY (store_id, day_of_week)` constraint, meaning one row per store per weekday. The solver's `StoreOpenHours` is typed as `[string, string][]` (an array of windows), supporting stores with mid-day closures. If any stores in the corpus have split hours, this is a schema limitation that would silently drop that information.

**Resolution (per Q6):** Single window per day is the right fidelity for this corpus. Stores with unusual split hours are outliers. The current schema is correct for the common case and the solver's multi-window support is a harmless forward capability. No action needed.

#### Issue 9 — Coord representation inconsistency in Solver

- `Anchor.coord` and `Store.coord` are `readonly [number, number]` tuples internally
- `StopPlan` emits `lat: number; lon: number` as separate named fields in output
- Trip JSON schema and all docs use `{ lat, lon }` object form

The tuple convention relies on remembering that index 0 = lat and index 1 = lon. Nothing in the type system enforces this. It is not a current bug, but it is a latent source of silent lat/lon swap errors, particularly for contributors working from the JSON schema documentation.

#### Issue 10 — Docs roadmap does not reflect actual implementation state

Several v0.2 features — locks, reoptimizeDay, infeasibility advisor, break window — are implemented and tested but the implementation doc still marks v0.2 as "In Progress." The roadmap table in `route-planner-implementation.md` should be updated to reflect what has actually shipped. This matters for onboarding and for scoping what remains to be done in v0.3.

---

### Simplification Opportunities

| Opportunity | Effort | Impact | Status |
|---|---|---|---|
| Pipeline glue script | Small | High | **Tier 1** — do now |
| Score injection CLI utility | Small | High | **Tier 1** — do now |
| Atlas ingestion type normalization dict | Trivial | Medium | **Tier 1** — do now |
| Update roadmap docs to reflect v0.2 completion | Trivial | Low | **Tier 1** — quick win |
| Haversine in kNN (`posterior.py`) | Trivial | Medium | **Tier 2** — after pipeline |
| Hours export utility | Small | Medium | **Tier 2** — after pipeline |
| Replace scratch IRLS with statsmodels | Medium | Medium | **Tier 2** — Python confirmed; unblocked |
| Makefile / run script | Small | Low | **Tier 2** — operational hygiene |
| dayOfApp: archive and document lessons | Trivial | Low | **Deferred** — prototype only |
| Antique/Vintage model consolidation | Small | Medium | **Deferred** — needs data review |
| Multi-window store hours schema | N/A | N/A | **No action** — single window confirmed correct |
| Atlas TypeScript port | Large | Speculative | **Deferred** — not near-term |

---

### Takeover Readiness Summary

**Strengths:**
- Code is clean, well-structured, and closely matches its documentation
- Test suite provides reasonable regression protection across both components
- Architecture decisions are sound and clearly explained in the docs
- Atlas's mathematical design (V/Y model, shrinkage, ECDF) is well-reasoned and documented
- The Solver is more complete than the docs suggest — less work remaining than it looks

**Gaps (as of March 2026):**
- No automated end-to-end pipeline from storedb → Atlas → Solver — the primary outstanding blocker
- Atlas ingestion silently maps `Junk`, `Boutique`, `Surplus`, and other storedb types to `Unknown` instead of explicit fallback categories
- Euclidean kNN in `posterior.py` is a correctness issue for multi-metro road trips (not local trips)
- Store hours data cannot flow from the DB into solver runs without a manual conversion step
- The scratch IRLS implementation is a maintenance liability now that Python is confirmed long-term

**Resolved (no longer open):**
- Usage model: local trip is primary today; pipeline is the path to road trip use
- Type taxonomy: storedb stays expansive; Atlas narrows at ingestion via explicit mapping
- dayOfApp: deferred — prototype-only, lessons noted for future in-trip app
- Python vs. TypeScript: Python stays; TypeScript port is speculative generality
- Multi-window hours: no action; single window per day is correct for this corpus

**Bottom line:** This is a well-designed project past the prototype stage in both components. The primary readiness gap is not algorithm quality or code structure — it is the **operational pipeline** connecting the pieces. The Florida trip is the near-term proving ground. Tier 1 work unblocks it directly.
