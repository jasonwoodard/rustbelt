# Rust Belt Atlas – Functional Requirements (v0.1 Implementation Status)

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.
It provides per-store Value/Yield scores, metro anchors, and store clusters to be consumed by the Rust Belt Solver.
Atlas sits upstream of Solver: **Atlas maps the landscape, Solver plans the journey.**

## Roadmap

- **v0.1 (Prototype, delivered)**: Prior/posterior/blended scoring pipelines, ω provenance, trace exports, and ECDF caching.
- **v0.2 (Ready for release)**: Metro anchors, sub-cluster nesting, posterior trace exports, Solver contract validation, and diagnostics reporters now ship with Atlas.
- **v0.3+**: Harden Solver integration tests, add affluence model calibration and automated anchor/cluster QA dashboards.

With v0.2 feature work landed and validated through CLI and Solver integration tests, Atlas is ready for promotion to the next milestone.

---

## Assessment of v0.1

The Python prototype under `packages/atlas-python/` delivers a fully working scoring CLI with prior, posterior, and blended modes, blend provenance, and trace exports. Prior and posterior pipelines are unit-tested end to end, and the CLI enforces the expected data contracts. Anchor detection, sub-clusters, Solver contract checks, and diagnostics reporters were deferred to v0.2 but are now implemented in the same package.

*Delivered capabilities*
- `rustbelt-atlas score` covers prior-only, posterior-only, and blended runs, enforces the affluence feature contract, and writes CSV/JSON outputs with optional λ and ω parameters.
- Prior scoring composes desk baselines with affluence adjustments, optional composite scores, and adjacency smoothing helpers for analysts who want spatial blending.
- Posterior scoring fits Poisson/NegBin GLMs with per-store fallbacks, ECDF-based Yield mapping, optional ECDF caching, and spatial kNN smoothing for unvisited stores.
- Output records include prior/posterior components, ω provenance, and trace rows that explain each store’s prior and blend contributions when `--trace-out` is used. Posterior diagnostics can be persisted via `--posterior-trace` for further analysis.

*Outstanding opportunities*
- Spatial smoothing remains opt-in via helper utilities; default adjacency pipelines are still under evaluation.
- Posterior QA heuristics could incorporate dwell/purchase covariates beyond the current θ-based signals.

---

## FR Index

| ID   | Title                          | Status     | Notes |
|------|--------------------------------|------------|-------|
| FR-1 | Store Scoring (Value–Yield)    | Delivered  | CLI enforces affluence inputs; prior scoring matches spec with optional λ and adjacency helper. |
| FR-1a | Posterior-Only Scoring        | Delivered  | GLM + hierarchical + kNN pipeline with ECDF Yield mapping and diagnostics export. |
| FR-1b | Blending Weight & Provenance  | Delivered  | Outputs ω, prior/posterior components, and blend traces; defaults configurable. |
| FR-2 | Metro Anchor Identification    | Delivered  | `atlas anchors` command clusters stores via DBSCAN/HDBSCAN and emits assignments + metrics. |
| FR-3 | Sub-Cluster Detection          | Delivered  | `atlas subclusters` materialises hierarchies from JSON specs and validates topology. |
| FR-4 | Explainability Trace           | Delivered  | Prior, posterior, and blend stages export JSONL/CSV traces with CLI inclusion flags. |
| FR-5 | Data Exchange with Solver      | Delivered  | Fixtures + tests validate CSV/JSON schemas against Solver contracts. |
| FR-6 | Diagnostics & Reports          | Delivered  | Diagnostics writers emit JSON, HTML, and Parquet summaries with QA signals. |

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
- Posterior hyper-parameter selection still relies on analyst configuration; automated cross-validation is a future enhancement.

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
**Status: Delivered in v0.2**

DBSCAN/HDBSCAN clustering for metro anchors ships under `atlas.clustering.anchors` and is surfaced via the `atlas anchors` CLI command. Runs can persist anchor metadata, store assignments, and clustering metrics for Solver.

**Implementation highlights**
- `AnchorDetectionParameters` supports DBSCAN and HDBSCAN configurations, haversine distance, metro identifiers, and custom ID prefixes.
- `detect_anchors` returns structured anchors, assignments, and metrics, with schema validation in CLI handlers.
- Fixture regeneration scripts exercise anchor detection to create regression datasets for integration testing.

---

## FR-3: Sub-Cluster Detection
**Status: Delivered in v0.2**

Sub-cluster hierarchies can now be materialised from JSON specifications using `atlas.clustering.subclusters`. The `atlas subclusters` CLI command validates topology constraints and writes nested IDs for downstream consumption.

**Implementation highlights**
- `build_subcluster_hierarchy` constructs parent/child relationships with validation against duplicate IDs and missing parents.
- Hierarchies export to DataFrames with anchor identifiers, depth ordering, and leaf store assignments.
- CLI tooling enforces schema correctness before emitting CSV/JSON outputs.

---

## FR-4: Explainability Trace
**Status: Delivered in v0.2**

**Delivered**
- `--trace-out` records prior, posterior, and blend contributions with per-stage inclusion flags so analysts can tailor payload size.
- Posterior traces stream from `PosteriorPipeline.iter_traces()` and can be emitted separately via `--posterior-trace` with CSV or JSONL encodings.
- `TraceRecord` utilities provide consistent flattening/hashing for trace payloads used across scoring stages.

**Remaining gaps**
- A consolidated explainability artifact (single CSV/JSON per run) would still simplify Solver-facing auditing beyond raw trace rows.

---

## FR-5: Data Exchange with Solver
**Status: Delivered in v0.2**

**Delivered**
- CLI writes CSV/JSON outputs with Value, Yield, Composite, ω, provenance, and diagnostics columns suitable for Solver ingestion.
- Solver CLI integration tests exercise Atlas fixtures (`dense-urban` scenarios) to enforce schema compatibility for scores, anchors, and cluster assignments.
- Posterior diagnostics can be persisted to CSV/Parquet for validation alongside scored stores.

**Remaining gaps**
- Schema versioning is tracked through diagnostics metadata but could benefit from published semver once Solver integration solidifies.

---

## FR-6: Diagnostics & Reports
**Status: Delivered in v0.2**

Atlas now emits diagnostics sidecars containing JSON summaries, HTML reports, and Parquet extracts with QA signals.

**Delivered**
- `compute_correlation_table` and `summarize_distributions` produce the statistical views consumed by CLI diagnostics output.
- QA heuristics highlight high-leverage anchors and outlier scores when anchor assignments are available.
- Writers materialise diagnostics in consistent directory layouts alongside score runs.

**Next steps**
- Expand HTML reports with richer visualisations and cross-run trend comparisons once Solver establishes dashboards.

---

## Out of Scope (v0.1)

- Route optimisation (Solver responsibility).
- Run shape filtering (Loop vs Haul) — flagged for Solver extension.
- Mid-day re-optimisation — Solver responsibility.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
