# Rust Belt Atlas – Functional Requirements (v0.1 Implementation Status)

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.
It provides per-store Value/Yield scores, metro anchors, and store clusters to be consumed by the Rust Belt Solver.
Atlas sits upstream of Solver: **Atlas maps the landscape, Solver plans the journey.**

---

## Assessment of v0.1

The Python prototype under `packages/atlas-python/` delivers a fully working scoring CLI with prior, posterior, and blended modes, blend provenance, and trace/diagnostic exports. Prior and posterior pipelines are unit-tested end to end, and the CLI enforces the expected data contracts. Anchor detection, sub-clusters, and the richer diagnostics package remain stubs, so the original v0.1 scope is only partially complete.

*Delivered capabilities*
- `rustbelt-atlas score` covers prior-only, posterior-only, and blended runs, enforces the affluence feature contract, and writes CSV/JSON outputs with optional λ and ω parameters.
- Prior scoring composes desk baselines with affluence adjustments, optional composite scores, and adjacency smoothing helpers for analysts who want spatial blending.
- Posterior scoring fits Poisson/NegBin GLMs with per-store fallbacks, ECDF-based Yield mapping, optional ECDF caching, and spatial kNN smoothing for unvisited stores.
- Output records include prior/posterior components, ω provenance, and trace rows that explain each store’s prior and blend contributions when `--trace-out` is used. Posterior diagnostics can be persisted via `--posterior-trace` for further analysis.

*Deferred or partial items*
- Metro anchors, sub-clusters, and diagnostics modules are placeholders with no executable implementation yet.
- Posterior trace records are captured in-memory but not yet exported alongside prior/blend traces, so explainability is partial for posterior mode.

---

## FR Index

| ID   | Title                          | Status     | Notes |
|------|--------------------------------|------------|-------|
| FR-1 | Store Scoring (Value–Yield)    | Delivered  | CLI enforces affluence inputs; prior scoring matches spec with optional λ and adjacency helper. |
| FR-1a | Posterior-Only Scoring        | Delivered  | GLM + hierarchical + kNN pipeline with ECDF Yield mapping and diagnostics export. |
| FR-1b | Blending Weight & Provenance  | Delivered  | Outputs ω, prior/posterior components, and blend traces; defaults configurable. |
| FR-2 | Metro Anchor Identification    | Deferred   | No anchor command or implementation in repository. |
| FR-3 | Sub-Cluster Detection          | Deferred   | Dependent on anchor work; module is empty. |
| FR-4 | Explainability Trace           | Partial    | Prior/blend traces shipped; posterior traces kept in memory only. |
| FR-5 | Data Exchange with Solver      | Partial    | CSV/JSON outputs align with Solver expectations but no direct integration tests or schema versioning yet. |
| FR-6 | Diagnostics & Reports          | Deferred   | Diagnostics package placeholder with no emitters. |

---

## FR-1: Store Scoring (Value–Yield)
**Status: Delivered in v0.1**

**Description**
Atlas computes desk-estimated **Value** and **Yield** scores for each store by combining store-type baselines, affluence signals, and optional adjacency adjustments.

**Implementation highlights**
- Baselines and affluence coefficients are hard-coded for the supported store types (`Thrift`, `Antique`, `Vintage`, `Flea/Surplus`, `Unknown`).
- `compute_prior_score` composes baseline + affluence + adjacency (when provided), clamps to the 1–5 scale, and optionally produces a composite score `λ·Value + (1-λ)·Yield`.
- CLI prior/blended runs require the normalised affluence columns (`MedianIncomeNorm`, `Pct100kHHNorm`, `PctRenterNorm`) or derive them from an affluence join, ensuring deterministic inputs.
- `knn_adjacency_smoothing` is available for analysts to smooth Value/Yield with nearby stores, though it is not yet wired into the CLI path.

**Acceptance Criteria coverage**
- AC1: Prior scores are deterministic per store type and affluence inputs; posterior overrides are recorded for downstream blending.
- AC2: Stores without observations rely solely on priors; adjacency helper can be applied manually if desired.
- AC3: Value/Yield/composite are clamped to `[1,5]`.
- AC4: CLI accepts optional `--lambda` to publish the composite column for Solver consumption.

**Gaps**
- Spatial smoothing is exposed as a helper but still needs first-class CLI plumbing if adjacency should be default behaviour.

---

## FR-1a: Posterior-Only Scoring (No Priors)
**Status: Delivered in v0.1**

**Description**
Atlas trains on observation logs to recover posterior Value/Yield estimates for all stores, falling back gracefully when data are sparse.

**Implementation highlights**
- `_summarise_observations` aggregates dwell time, purchases, and Value to compute store-level statistics.
- `_solve_glm` fits Poisson/NegBin GLMs on θ (items per 45 minutes) with IRLS; `_solve_linear_model` estimates Value via weighted least squares.
- `PosteriorPipeline.predict` blends GLM, hierarchical, and kNN outputs, maps θ to Yield via a persisted ECDF, clamps Value to `[1,5]`, and computes a credibility score.
- CLI requires `--observations` in posterior/blended modes and can persist ECDF caches and diagnostics snapshots via `--posterior-trace` and `--ecdf-cache`.

**Acceptance Criteria coverage**
- AC1: Visited stores recover observed θ and Value when sample counts allow (GLM/Hier branches).
- AC2: Unvisited stores receive kNN-smoothed predictions with non-empty `Method` and credibility fields.
- AC3: Yield mapping reuses the ECDF window logic and clamps to `[1,5]`.
- AC4: Pipeline is deterministic for a given dataset; ECDF caches ensure reproducibility when configured.

**Gaps**
- Posterior trace records are generated but not yet exported alongside prior traces (see FR-4).

---

## FR-1b: Blending Weight and Provenance
**Status: Delivered in v0.1**

**Description**
Atlas emits the blending weight ω and keeps the prior/posterior components visible in outputs and traces.

**Implementation highlights**
- `_blend_scores` merges prior and posterior frames, injects ω per store, recomputes the composite score when λ is set, and defaults ω to 0/1 when only one source is available.
- `_build_blend_trace_records` produces per-store trace rows capturing ω, prior/posterior values, and final scores for auditing.
- CLI writes these traces to JSONL when `--trace-out` is supplied; tests validate the provenance columns and ω semantics.

**Acceptance Criteria coverage**
- AC1: ω ∈ [0,1] enforced via CLI validation and merge logic.
- AC2: Prior-only runs emit ω=0; posterior-only runs emit ω=1.
- AC3: Blended runs respect CLI-supplied ω for stores with both sources.
- AC4: Outputs retain prior/posterior components and the final blend, satisfying transparency goals.

---

## FR-2: Metro Anchor Identification
**Status: Deferred**

There is no implementation for metro anchors in the prototype. The `atlas.clustering` module is a placeholder, and the CLI exposes no `anchors` command yet.

**Next steps**
- Implement anchor detection (e.g., DBSCAN/HDBSCAN over lat/lon) with configurable parameters.
- Define output schema and wire a CLI subcommand that emits anchors for downstream Solver use.

---

## FR-3: Sub-Cluster Detection
**Status: Deferred**

Sub-clusters depend on anchor detection and likewise have no executable code in the repository. Future work should extend the clustering module once anchors exist.

---

## FR-4: Explainability Trace
**Status: Partial in v0.1**

**Delivered**
- `--trace-out` records prior contributions (baseline, affluence, adjacency, posterior overrides) plus blend provenance per store in JSONL form for reproducible audits.
- `TraceRecord` utilities provide consistent flattening/hashing for trace payloads used across scoring stages.

**Remaining gaps**
- Posterior traces are built inside `PosteriorPipeline` but never exported, so analysts cannot yet inspect GLM vs hierarchical contributions without instrumenting Python directly.
- A consolidated explainability artifact (single CSV/JSON per run) would simplify Solver-facing auditing once posterior traces are exposed.

---

## FR-5: Data Exchange with Solver
**Status: Partial in v0.1**

**Delivered**
- CLI writes CSV/JSON outputs with Value, Yield, Composite, ω, and provenance columns suitable for Solver ingestion.
- Posterior diagnostics can be persisted to CSV/Parquet for validation alongside scored stores.

**Remaining gaps**
- No automated contract tests exist with the Solver repository, and schema versioning is not yet formalised. Coordinated integration tests should be added before declaring the data contract stable.

---

## FR-6: Diagnostics & Reports
**Status: Deferred**

The diagnostics module is currently a stub; no correlation analyses, distribution reports, or outlier detection are emitted in the prototype.

**Next steps**
- Implement JSON/HTML report generation that summarises affluence correlations, Value/Yield distributions, and anchor/cluster stats once those features exist.

---

## Out of Scope (v0.1)

- Route optimisation (Solver responsibility).
- Run shape filtering (Loop vs Haul) — flagged for Solver extension.
- Mid-day re-optimisation — Solver responsibility.

---

## Roadmap

- **v0.1 (Prototype, delivered)**: Prior/posterior/blended scoring pipelines, ω provenance, trace exports, and ECDF caching.
- **v0.2 (Next)**: Ship metro anchors and sub-clusters, surface posterior traces in explainability outputs, and stand up initial diagnostics/reporting.
- **v0.3+**: Harden Solver integration tests, add affluence model calibration and automated anchor/cluster QA dashboards.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
