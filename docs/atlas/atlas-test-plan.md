# Atlas Test Plan (V/Y Scoring & Modes)

This plan validates Atlas against its two core scoring use cases:

1) **Prior-Only** — Stores + ZIP demographics, **no observations** → ranked V/Y (and optional 1-D score)  
2) **Posterior / Blended** — Stores + ZIP + **observations** → ranked V/Y with credibility; optionally blended with priors

It mirrors the Rust Belt Solver test style (clear inputs, commands, acceptance criteria, and artifacts) to ensure reproducibility.

> Need the full CLI contract? See the [Atlas CLI reference](./atlas-cli-reference.md) for command flags, schema definitions, and diagnostics outputs.

---

## 0. Objective & Scope

- Verify Atlas produces **explainable, reproducible** per-store Value (V) and Yield (Y) scores.
- Confirm **modes** behave as designed: `prior-only`, `posterior-only`, `blended`.
- Ensure optional **projection** (`Composite` column) is consistent with λ choices.
- Validate optional **anchors** and **clusters** outputs.
- Establish diagnostics, performance, and regression criteria.

Out of scope: UI and route optimization (covered by Solver).

---

## 1. Datasets

**Required**
- `stores.csv` — `StoreId,Name,Type,Lat,Lon,Zip`
- `zcta.csv` — `Zip,MedianIncome,PctHH_100kPlus,PctRenters,Population` (+ normalized variants if precomputed)

**For Use Case #2**
- `observations.csv` — `StoreId,DateTime,DwellMin,PurchasedItems,HaulLikert` with optional columns (`ObserverId`, `Spend`, `Notes`, precomputed affluence covariates) preserved end-to-end.

> Recommendation: Use one metro (e.g., Detroit) for fitting and a second (e.g., Ann Arbor) for hold-out sanity checks. Aim for ≥100 stores.

---

## 2. Configuration Under Test

- **Mode:** `prior-only` | `posterior-only` | `blended`
- **ECDF window:** `day` | `metro` (default) | `trip` | `corpus`
- **λ (projection):** `0.8` (Harvest) | `0.6` (Balanced) | `0.4` (Explore) — only when emitting 1-D
- **ω (blend weight):** `[0..1]` (e.g., `0.7`) — only in `blended` mode
- **Seeds & hashing:** deterministic runs with config+data hashes in output header

---

## 3. Expected Columns (Scored Output)

Per store (CSV/JSON, per [`score.schema.json`](../../schema/atlas/v1/score.schema.json)):
- `StoreId, Value, Yield`
- Optional projection: `Composite` (when `--lambda` provided)
- Blend diagnostics: `Omega`, `ValuePrior`, `ValuePosterior`, `YieldPrior`, `YieldPosterior`
- Core provenance: `Theta`, `Cred`, `Method`, `ECDF_q`

For anchors/clusters (JSON):
- `AnchorId/ClusterId, centroid, bounds/geom, store_count, mean_V, mean_Y, affluence_summary`

---

## 4. Test Cases

### TC-P1 — Prior-Only Scoring

**Inputs:** `stores.csv`, `zcta.csv`  
**Command (illustrative):**
```bash
rustbelt-atlas score \
  --stores data/stores.csv \
  --affluence data/zcta.csv \
  --mode prior-only \
  --ecdf-window metro \
  --lambda 0.6 \
  --output out/scored-prior.csv \
  --trace-out out/scored-prior-trace.jsonl
```

**Acceptance Criteria (AC-P1):**
- **AC-P1.1** Output contains `StoreId,Value,Yield,Theta,Composite` (λ projection present because `--lambda` provided).
- **AC-P1.2** Sign sanity: on average, higher `MedianIncome` → higher **V**; higher `PctRenters` → lower **Y**.
- **AC-P1.3** No missing values; `ECDF_q ∈ [0,1]`.
- **AC-P1.4** Determinism: identical inputs/config produce identical ranks and file hash.

---

### TC-PO1 — Posterior-Only Scoring

**Inputs:** `stores.csv`, `observations.csv` (optionally `zcta.csv` for covariates)  
**Command:**
```bash
rustbelt-atlas score \
  --stores data/stores.csv \
  --observations data/observations.csv \
  --mode posterior-only \
  --ecdf-window metro \
  --lambda 0.6 \
  --output out/scored-post.csv \
  --trace-out out/scored-post-trace.jsonl \
  --posterior-trace out/posterior-trace.csv
```

**Acceptance Criteria (AC-PO1):**
- **AC-PO1.1** For visited stores: `Value ≈ HaulLikert` and `Yield` consistent with `PurchasedItems` & `DwellMin` via ECDF; CLI validation rejects rows missing required observation fields before scoring.
- **AC-PO1.2** For unvisited stores: `Method` is set (`GLM|Hier|kNN|AnchorMean`) and `Cred ∈ [0,1]`.
- **AC-PO1.3** Determinism: same inputs → identical ranks and file hash.
- **AC-PO1.4** Incremental learning: adding one new observation reorders a plausible **local** neighborhood of unvisited stores (document delta count).
- **AC-PO1.5** Posterior runs still emit `Composite` when `--lambda` is provided, and `ECDF_q` stays within `[0,1]`.

---

### TC-B1 — Blended Scoring

**Inputs:** `stores.csv`, `zcta.csv`, `observations.csv`  
**Command:**
```bash
rustbelt-atlas score \
  --stores data/stores.csv \
  --affluence data/zcta.csv \
  --observations data/observations.csv \
  --mode blended --omega 0.7 \
  --ecdf-window metro \
  --lambda 0.6 \
  --output out/scored-blended.csv \
  --trace-out out/scored-blended-trace.jsonl
```

**Acceptance Criteria (AC-B1):**
- **AC-B1.1** For visited stores: observed Value/Yield take precedence (single-observer policy).
- **AC-B1.2** For unvisited stores: blended Value/Yield land **between** prior-only and posterior-only predictions (prove with sample rows).
- **AC-B1.3** ω sensitivity: ω=1 equals posterior-only ranks; ω=0 equals prior-only ranks; small ω changes adjust ranks smoothly (no discontinuities).
- **AC-B1.4** λ sensitivity: harvest (0.8) > balanced (0.6) > explore (0.4) shifts ordering in expected directions (document top-10 diffs).
- **AC-B1.5** `Composite`, `Omega`, and prior/posterior component columns align with [`score.schema.json`](../../schema/atlas/v1/score.schema.json).

---

## 5. Anchors & Clusters (Optional, but Recommended)

**Commands:**
```bash
rustbelt-atlas anchors \
  --stores data/stores.csv \
  --affluence data/zcta.csv \
  --output out/anchors.csv \
  --store-assignments out/anchor-assignments.csv \
  --metrics out/anchor-metrics.json

rustbelt-atlas subclusters \
  --anchor-id metro-anchor-001 \
  --spec data/subcluster-spec.json \
  --output out/subclusters.jsonl \
  --id-prefix metro-anchor-001-sc
```

**Acceptance Criteria:**
- **AC-A1** Anchors correspond to coherent high-signal areas (affluence and/or high Y); include summary stats.
- **AC-C1** Sub-clusters align with short drive times; each store has ≤1 subcluster id; summaries (mean Value/Yield) are reported.

---

## 6. Diagnostics & Validation

- **Correlation sanity:** `corr(V, MedianIncome) > 0`; `corr(Y, PctRenters) < 0` at metro level.
- **Distribution sanity:** V and Y in `[1,5]`; `ECDF_q` spread across `(0,1)`; no pathological spikes after mapping.
- **Explainability:** `posterior-explain.json` lists top contributors per store (signs & magnitudes) in `posterior-only` / `blended` runs.

---

## 7. Reproducibility

- Persist config + input hashes in output headers.  
- Re-run with identical inputs → identical outputs (bytewise).  
- Store the **ECDF window** definition in the header (`day|metro|trip|corpus`) and verify reuse across runs.

---

## 8. Performance

- With ~100–500 stores, scoring should complete in seconds on a laptop.  
- Joins and ECDF computations are cached per run.  
- Record wall-clock times and peak memory; flag regressions >20%.

---

## 9. Regression Testing

- Maintain gold outputs under `testdata/gold/`:
  - `scored-prior.gold.csv`
  - `scored-post.gold.csv`
  - `scored-blended.gold.csv`
- After code/model changes, diff new vs gold:
  - Large rank deltas must be explained (config, coefficients, data changes).
  - Update gold only with documented, intentional changes.

---

## 10. Artifacts Produced

- `out/scored-prior.csv`  
- `out/scored-post.csv`  
- `out/scored-blended.csv`  
- `out/posterior-explain.json`  
- `out/anchors.csv` (optional)
- `out/anchor-assignments.csv` (optional)
- `out/anchor-metrics.json` (optional)
- `out/subclusters.jsonl` (optional)

Each scored CSV **must** include the schema-aligned columns: `StoreId,Value,Yield,Composite (when λ supplied),Omega,ValuePrior,ValuePosterior,YieldPrior,YieldPosterior,Theta,Cred,Method,ECDF_q`.

---

## 11. Risks & Mitigations

- **Sparse observations:** fall back to hierarchical pooling or k-NN with `Cred` < threshold; surface to user.
- **Outliers:** winsorize extreme `ItemsPer45` before ECDF; log outlier handling.
- **ZIP granularity:** acceptable for MVP; document when tracts are substituted.
- **Confirmation bias:** keep hold-out metro; publish failed predictors and ablations.

---

## 12. Sign-off Criteria

- All acceptance criteria in TC-P1, TC-PO1, and TC-B1 pass.  
- Diagnostics show expected correlation signs.  
- Determinism, performance, and regression gates are green.

