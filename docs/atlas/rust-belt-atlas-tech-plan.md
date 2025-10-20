# Rust Belt Atlas – Technical Plan (v0.1 Draft)

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.  
It ingests store lists, affluence data, and observations to produce Value–Yield scores, metro anchors, and clusters.  
Atlas outputs are consumed by the Rust Belt Solver.

---

## Goals

1. **Per-store scoring**: assign Value and Yield scores that align with observed trip outcomes.  
2. **Anchors**: identify natural metro-level clusters (exploration areas).  
3. **Sub-clusters**: identify curated pockets within anchors.  
4. **Explainability**: provide a transparent trace of scoring decisions.  
5. **Interoperability**: output formats compatible with Solver inputs.  
6. **Scalability**: support new metros without rewriting desk estimates by leaning on affluence and adjacency priors.  

---

## Architecture

### Modules
- **Data Ingestion**  
  - Store list (CSV/JSON).  
  - Affluence data (ACS census, turnover, housing, retail density).  
  - Observations (Value–Yield, notes, dates).  

- **Scoring Engine**  
  - Baseline priors by store type.  
  - Affluence adjustments (boost/dampen Value/Yield).  
  - Adjacency inference (smooth toward neighbor means).  
  - Observed override (posterior mean from trip data).  
  - Output: per-store Value, Yield, Composite JScore.  

- **Anchor Detection**  
  - Algorithm: DBSCAN/HDBSCAN on lat/lon (minPts=3–5).  
  - Anchor record: `AnchorId, centroid, store count, mean Value, mean Yield`.  

- **Cluster Detection**  
  - Within anchors, apply fine-grained clustering by lat/lon + score similarity.  
  - Output: `ClusterId, AnchorId, member stores, centroid`.  

- **Explainability**  
  - Per-store trace of contributions (baseline + affluence + adjacency + observed).  
  - Human-readable strings + machine-readable JSON.  

- **Diagnostics**  
  - Correlation between affluence signals and observed Value/Yield.  
  - Distribution scatterplots.  
  - Anchor summaries.  

---

## CLI Design

```bash
# Score all stores
rustbelt-atlas score \
  --stores data/stores.csv \
  --affluence data/affluence.csv \
  --observations data/observations.csv \
  --mode blended \
  --lambda 0.6 \
  --output out/scored-stores.csv \
  --trace-out out/prior-trace.jsonl \
  --posterior-trace out/posterior-diagnostics.csv

# Build metro anchors
rustbelt-atlas anchors \
  --stores out/scored-stores.csv \
  --out out/anchors.json

# Cluster within anchors
rustbelt-atlas clusters \
  --stores out/scored-stores.csv \
  --anchors out/anchors.json \
  --out out/clusters.json
````

**Common flags**: `--min-anchor`, `--radius`, `--format` (csv/json/html), `--diagnostics`.

## CLI Design (updated)

# Posterior-only scoring (learn from observations; no priors)
rustbelt-atlas score \
  --stores data/stores.csv \
  --observations data/observations.csv \
  --mode posterior-only \
  --ecdf-window metro \
  --output out/scored-post.csv \
  --posterior-trace out/posterior-diagnostics.csv

> `observations.csv` must include `StoreId,DateTime,DwellMin,PurchasedItems,HaulLikert` with optional covariates such as `ObserverId`, `Spend`, or `Notes`. CLI validation rejects rows missing the required five columns and forwards optional fields to downstream modeling.

# Blended scoring (when priors exist)
rustbelt-atlas score \
  --stores data/stores.csv \
  --affluence data/affluence.csv \
  --observations data/observations.csv \
  --mode blended --lambda 0.7 \
  --output out/scored-blend.csv

**New flags**
- `--mode {posterior-only|prior-only|blended}`
- `--lambda <0..1>` shrinkage weight for blended mode
- `--output <path>` destination for scored stores (CSV/JSON)
- `--trace-out <path>` JSONL prior trace output (optional)
- `--posterior-trace <path>` posterior diagnostics snapshot (optional)
- `--ecdf-window {day|metro|trip|corpus}`
- `--ecdf-cache <path>` persist ECDF reference for reproducibility
- `--explain/--trace-dir` generate a lightweight sample trace (documentation aid)


---

## Data Schemas

### Input: stores.csv

| StoreId | Name | Type | Lat | Lon | ChainFlag | Notes |

### Input: affluence.csv

| GeoId | MedianIncome | %100k+HH | Education | HomeValue | Turnover |

### Input: observations.csv

| StoreId | DateTime | DwellMin | PurchasedItems | HaulLikert | ObserverId (opt) | Spend (opt) | Notes (opt) |

**Example row**

| StoreId | DateTime           | DwellMin | PurchasedItems | HaulLikert | ObserverId | Spend | Notes            |
|---------|--------------------|----------|----------------|------------|------------|-------|------------------|
| DT-014  | 2025-03-02T14:10Z  | 52       | 4              | 5          | J          | 86.25 | Found denim haul |

### Output: scored-stores.csv

| StoreId | Value | Yield | Composite | AnchorId | ClusterId | SourceTrace |

### Output: anchors.json

```json
{
  "AnchorId": "DT-1",
  "Centroid": [42.331, -83.045],
  "StoreCount": 12,
  "MeanValue": 3.6,
  "MeanYield": 3.2,
  "Stores": ["S1", "S2", "S3"]
}
```

### Output: clusters.json

```json
{
  "ClusterId": "AA-2A",
  "AnchorId": "AA-2",
  "Centroid": [42.2808, -83.743],
  "Stores": ["C1", "C2", "C3"],
  "MeanValue": 4.0,
  "MeanYield": 2.7
}
```

---

## Package & Directory Strategy

### Objectives

- Guarantee Atlas can be developed, tested, and released without any compile-time or runtime dependency on the existing Solver tooling.
- Provide clear ownership boundaries so Atlas contributors do not need the Solver node toolchain, and vice versa.
- Create space for the Python-first Atlas prototype while leaving a migration path to a TypeScript port once the modeling solidifies.

### Proposed Repository Layout

```
/docs/
/schema/                    # JSON/CSV contracts shared across projects (read-only dependencies)
/packages/
  atlas-python/             # Python package (Phase 1 focus)
    pyproject.toml
    src/atlas/
      __init__.py
      cli/
      data/
      scoring/
      clustering/
      explain/
      diagnostics/
      fixtures/
    tests/
  solver-cli/               # Existing TypeScript CLI moved from /src (no Atlas imports)
    package.json
    tsconfig.json
    src/
    tests/
/tools/                     # Optional shared utilities (lint hooks, formatters) with language-specific subfolders
```

- **Atlas package**: published as `atlas-python` (internal), exposes `atlas.cli` entry points (`score`, `anchors`, `clusters`). Dependencies live in `pyproject.toml` so Node modules are not required.
- **Solver package**: retains current functionality but relocated under `packages/solver-cli` with unchanged build scripts. Solver consumes Atlas outputs only via files in `/schema` (e.g., versioned CSV layout, JSON schema) and never imports Python code.
- **Schema directory**: houses the versioned data contracts that mediate Atlas ↔ Solver exchange. Both sides depend on this directory **read-only**; no runtime linkage.
- **Top-level tooling**: optional scripts (e.g., Makefile, CI) orchestrate `pip` and `npm` commands without mingling dependency graphs.

### Enforcing Independence in Code

- Distinct package managers (`pip` for Atlas, `npm` for Solver) and lockfiles stored beside each package prevent accidental cross-installation.
- CI will run `pytest`/`ruff` for Atlas and `vitest`/`eslint` for Solver in separate jobs; any import attempt across the boundary will fail because the other language runtime is not installed in that job.
- Shared artifacts are serialized files only. The Atlas CLI writes to `/out` (or configured path) using schemas defined in `/schema`. Solver integration tests read those fixtures but never import Atlas modules.
- Introduce interface tests in Solver that use frozen Atlas output fixtures checked into `packages/atlas-python/fixtures/solver-contract/`. Updates require bumping the schema version and regenerating fixtures via the Atlas CLI.

### Option Analysis

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Minimal movement** | Keep current Solver layout in `/src`, drop Atlas under `/atlas` | Lowest churn today; no path changes for Solver developers | Mixed toolchains at repo root; harder to communicate boundaries; risk of accidental imports as Solver evolves |
| **B. Dedicated `/packages` monorepo (recommended)** | Relocate Solver to `/packages/solver-cli`; place Atlas prototype in `/packages/atlas-python`; share schemas via `/schema` | Clear ownership, isolated dependencies, mirrors common monorepo practices (npm/pip side-by-side), simplifies CI matrix | One-time refactor of Solver paths/build scripts; developers update import paths referencing compiled bundles |
| **C. Separate repositories** | Split Atlas into its own repo | Absolute isolation | Adds release coordination overhead; loses shared Git history and shared schema folder |

Option **B** balances isolation with maintainability. We absorb a one-time move of Solver code but keep a unified repo for change management and shared contracts.

### Tooling & Automation Implications

- Update root `package.json` scripts or introduce a top-level `Makefile` to forward to `pip`/`npm` tasks (`make atlas-test`, `make solver-build`).
- Add `.pre-commit-config.yaml` limited to Atlas Python checks; Solver retains ESLint/Prettier via npm scripts.
- Document environment setup in `docs/atlas/README.md`, specifying that Atlas contributors only need Python ≥3.11 and optional virtualenv tooling.
- Create CI workflows: `ci-atlas.yml` (setup-python → install → lint/test) and `ci-solver.yml` (setup-node → install → lint/test). Shared schema updates trigger both workflows via a path filter on `/schema`.

## Implementation Plan

### Phase 0 (Repo Preparation)

* Introduce the `/packages` + `/schema` structure without altering Solver functionality.
* Scaffold `packages/atlas-python` with `pyproject.toml`, `src/atlas/cli/__main__.py`, and placeholder modules for scoring/anchoring to unblock incremental commits.
* Configure CI jobs (Python + Node) and update documentation to reference the new directory layout.

### Phase 1 (v0.1 Prototype)

* Implement scoring engine in Python (pandas, geopandas).
* CLI: `score` command only.
* Output: scored stores with Value, Yield, and machine-captured trace fields to unblock later explainability UI.

- Implement Posterior-Only pipeline:
  - Fit Yield GLM with offset; fallback to NegBin if overdispersed.
  - Fit Value OLS (MVP).
  - If n too small: hierarchical pooling by type/anchor; otherwise k-NN smoothing.
  - Compute ECDF on observed θ̂ and map predictions to Y.
  - Emit Cred (e.g., 1 − normalized SE) and Method.


### Phase 2 (v0.2)

* Add metro anchors (DBSCAN clustering).
* Promote explainability traces to user-facing outputs, leveraging the trace fields landed in Phase 1.
* Introduce diagnostics (scatterplots, correlation tables).

### Phase 3 (v0.3)

* Add sub-cluster detection.
* Refine affluence adjustment model.
* Output Solver-compatible candidate sets.

### Phase 4 (Integration)

* Evaluate TypeScript parity for Atlas logic once Python models stabilize; spin up `packages/atlas-ts` if parity is justified, generated from shared schema definitions.
* Maintain Solver integration strictly through schema-driven file exchange; publish any reusable logic as independent libraries rather than direct package imports.
* Optional: introduce orchestration scripts (e.g., `make run-all`) that call Atlas CLI then Solver CLI sequentially while preserving package isolation.

---

## Additional Technical Considerations Before Implementation

### Data Validation & Contracts

- Define JSON Schema files in `/schema/atlas/v1/` for `scored-stores`, `anchors`, and `clusters`, and use them both for Atlas output validation (via `jsonschema` in Python) and Solver ingestion tests (via TypeScript validators).
- Version schemas (`v1`, `v1.1`, …) to allow non-breaking additions; Atlas exposes a `--schema-version` flag with default `latest`.

### Configuration Management

- Store CLI defaults in `atlas/config/defaults.yaml`, override via `--config` flag, and surface applied configuration in run metadata.
- Provide an `.env` template for sensitive paths (e.g., census API tokens) and load them only within Atlas; no leakage to Solver environment variables.

### Observability & Telemetry

- Emit structured logs (JSONL) from Atlas CLI capturing dataset checksums, parameter choices, and timing for each stage; logs stored beside outputs for reproducibility.
- Plan for optional Prometheus metrics if Atlas graduates to a service, but keep CLI instrumentation simple (`click` progress bars + final summary table).

### Testing Enhancements

- Expand golden fixtures covering edge-case metros (dense urban vs sparse rural) stored under `packages/atlas-python/fixtures/`.
- Provide contract tests ensuring the Atlas CLI refuses to overwrite Solver fixture directories unless `--force` is specified, reducing accidental regression noise.

### Documentation

- Author `docs/atlas/README.md` with setup instructions, architectural diagrams, and CLI walkthroughs.
- Cross-link Solver docs to the schema directory instead of Atlas internals, reinforcing the package boundary.

---

## Feedback Loop

1. **User runs Atlas** to score stores and generate anchors/clusters.
2. **User geo-curates**: select metros/clusters for inclusion in Solver runs.
3. **Solver produces itineraries**.
4. **User executes trip and logs observations**.
5. **Observations flow back into Atlas** → priors updated → next iteration improves.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
