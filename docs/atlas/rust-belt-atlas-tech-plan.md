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
  --out out/scored-stores.csv \
  --explain out/scored-explain.json

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
  --out out/scored-post.csv \
  --explain out/posterior-explain.json

> `observations.csv` must include `StoreId,DateTime,DwellMin,PurchasedItems,HaulLikert` with optional covariates such as `ObserverId`, `Spend`, or `Notes`. CLI validation rejects rows missing the required five columns and forwards optional fields to downstream modeling.

# Blended scoring (when priors exist)
rustbelt-atlas score \
  --stores data/stores.csv \
  --affluence data/affluence.csv \
  --observations data/observations.csv \
  --mode blended --omega 0.7 \
  --out out/scored-blend.csv

**New flags**
- `--mode {posterior-only|prior-only|blended}`
- `--omega <0..1>` shrinkage weight for blended mode
- `--ecdf-window {day|metro|trip|corpus}`


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

## Implementation Plan

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

* Port to TypeScript for Rust Belt repo integration.
* Optional: merge Atlas outputs into Solver pipeline as pre-processing stage.

---

## Feedback Loop

1. **User runs Atlas** to score stores and generate anchors/clusters.
2. **User geo-curates**: select metros/clusters for inclusion in Solver runs.
3. **Solver produces itineraries**.
4. **User executes trip and logs observations**.
5. **Observations flow back into Atlas** → priors updated → next iteration improves.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
