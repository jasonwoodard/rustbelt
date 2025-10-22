# Rust Belt Atlas – Functional Requirements (v0.1 Draft)

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.  
It provides per-store Value/Yield scores, metro anchors, and store clusters to be consumed by the Rust Belt Solver.  
Atlas sits upstream of Solver: **Atlas maps the landscape, Solver plans the journey.**

---

## FR Index

| ID     | Title                       | Description                                                                 |
|--------|-----------------------------|-----------------------------------------------------------------------------|
| FR-1   | Store Scoring (Value–Yield) [DONE] | Compute desk-estimated Value/Yield scores for each store using baselines, affluence, adjacency, and observations. |
| FR-1a  | Posterior-Only Scoring (No Priors) [DONE]   | Fit from observations only; predict to unvisited stores; emit credibility. |
| FR-2   | Metro Anchor Identification | Group stores into metro-level anchors representing natural exploration areas. |
| FR-3   | Sub-Cluster Detection       | Identify finer-grained clusters of stores within anchors (curated pockets). |
| FR-4   | Explainability Trace [DONE]       | Provide per-store explanations showing how final scores were derived.       |
| FR-5   | Data Exchange with Solver   | Output Atlas data in a format directly consumable by the Rust Belt Solver. |
| FR-6   | Diagnostics & Reports       | Emit validation metrics, correlation analysis, and summaries of anchors/clusters. |

---

## FR-1: Store Scoring (Value–Yield)

**Description**  
Atlas computes desk-estimated **Value** and **Yield** scores for each store.  

- **Value** = payoff per item (rarity, quality, satisfaction).  
- **Yield** = reliability / hit rate (how often items are found, volume per visit).  

**Inputs**  
- Store type baseline priors (e.g., Thrift baseline vs Antique baseline).  
- Affluence signals (census income, turnover, housing value, retail density).  
- Adjacency to observed stores (local smoothing).  
- Past observations (posterior mean Value/Yield).  

**Outputs**  
- Per-store: `StoreId, Value, Yield, CompositeScore`.  
- Optional composite JScore = λ·Value + (1–λ)·Yield.  

**Acceptance Criteria**  
- AC1: For any store with observations, posterior mean overrides desk priors.  
- AC2: For unvisited stores, Value/Yield computed from baseline + affluence + adjacency.  
- AC3: Scores always fall on a 1–5 scale.  
- AC4: Composite JScore is optional, Solver can consume either 2D or 1D scores.  

---

## FR-1a: Posterior-Only Scoring (No Priors)

**Description**  
Atlas trains on observed visits (t, N, V) to produce posterior predictions for all stores **without** desk priors.

**Inputs**
- Observations: `StoreId, DateTime, DwellMin, PurchasedItems, HaulLikert` (+ optional covariates such as `ObserverId`, `Spend`, `Notes`, pre-joined affluence).
- Store catalog: id, type, lat/lon, ZIP.

**Outputs**  
- Per-store: `V_est`, `theta_est`, `Y_est`, `Cred`, `Method` (GLM|Hier|kNN|AnchorMean).

**Acceptance Criteria**  
- AC1: For visited stores, `V_est` and `Y_est` recover observed scores (within tolerance).  
- AC2: For unvisited stores, predictions are produced with a non-empty `Method` and `Cred`.  
- AC3: Y mapping uses the same ECDF window as the observations.  
- AC4: Reproducible given the same observation set.

---

### FR-1b: Blending Weight and Provenance

**Description**  
Atlas shall compute and emit the blending weight ω used to combine prior and posterior estimates per store.

**Acceptance Criteria**
- AC1: ω ∈ [0,1] and logged globally and/or per store.
- AC2: When `mode=prior-only`, ω=0.0; when `mode=posterior-only`, ω=1.0.
- AC3: When `mode=blended`, ω reflects the configured value or adaptive function.
- AC4: Output includes prior, posterior, and blended components for both Value and Yield.

**Rationale**  
This enables transparent auditing of how strongly each model influenced the blended outcome and supports debugging score movements across runs.

---

## FR-2: Metro Anchor Identification

**Description**  
Atlas groups stores into **metro anchors** representing natural exploration areas.  

**Inputs**  
- Store list with lat/lon and scores.  

**Outputs**  
- Anchor list with `AnchorId, centroid(lat/lon), store count, mean Value, mean Yield`.  

**Acceptance Criteria**  
- AC1: Anchors contain ≥3 stores by default (configurable).  
- AC2: Anchors must be spatially coherent (stores within threshold distance R).  
- AC3: Every store is assigned to exactly one anchor.  
- AC4: Anchor scores reported as averages of member stores.  

---

## FR-3: Sub-Cluster Detection

**Description**  
Within each anchor, Atlas identifies finer-grained **clusters** of stores that represent curated pockets.  

**Inputs**  
- Anchor assignments.  
- Store lat/lon, Value/Yield scores.  

**Outputs**  
- Cluster list with `ClusterId, AnchorId, store membership, centroid`.  

**Acceptance Criteria**  
- AC1: Clusters must be subsets of a single anchor.  
- AC2: Clustering method uses distance + score similarity (configurable algorithm, e.g., DBSCAN).  
- AC3: Every store is assigned to exactly one cluster.  
- AC4: Clusters report centroid and average Value/Yield.  

---

## FR-4: Explainability Trace

**Description**  
Atlas generates a human-readable explanation for how each store’s scores were derived.  

**Inputs**  
- Baseline priors, affluence adjustments, adjacency adjustments, observations.  

**Outputs**  
- Per-store JSON/CSV explanation record.  
- Example:  


**Acceptance Criteria**  
- AC1: Every store has an explanation trace.  
- AC2: Trace lists all contributing factors (baseline, affluence, adjacency, observed).  
- AC3: Trace must be reproducible — rerunning Atlas with same data yields same explanation.  

---

## FR-5: Data Exchange with Solver

**Description**  
Atlas outputs data in a format consumable by the Rust Belt Solver.  

**Inputs**  
- Scored stores, anchors, clusters.  

**Outputs**  
- CSV/JSON candidate sets with scores and cluster/anchor context.  

**Acceptance Criteria**  
- AC1: Solver can run using Atlas outputs without schema modification.  
- AC2: Output schema documented and versioned.  
- AC3: Candidate sets may be reduced in size (but always ≥ expected number of daily stops).  

---

## FR-6: Diagnostics & Reports

**Description**  
Atlas provides validation and diagnostic outputs to support model refinement.  

**Outputs**  
- Correlation between affluence signals and observed scores.  
- Distribution plots of Value vs Yield.  
- Anchor summaries (store counts, mean scores).  
- Outlier detection (stores far from cluster/anchor mean).  

**Acceptance Criteria**  
- AC1: Diagnostics can be emitted in JSON or HTML report form.  
- AC2: Reports highlight discrepancies (e.g., affluence predicted high Value but observed low).  
- AC3: Reports summarize anchor/cluster properties (count, means, spread).  

---

## Out of Scope (v0.1)

- Route optimization (Solver responsibility).  
- Run shape filtering (Loop vs Haul) — flagged for Solver extension.  
- Mid-day re-optimization — Solver responsibility.  

---

## Roadmap

- **v0.1 (Prototype)**: Store scoring pipelines (FR-1, FR-1a) and trace field capture needed for downstream explainability.
- **v0.2**: Metro anchors (FR-2), explainability (FR-4), richer diagnostics (FR-6) — explainability ships here because it depends on the trace fields stabilized in v0.1.
- **v0.3**: Affluence models + neighbor inference refinement, sub-clusters (FR-3), Solver integration (FR-5).

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
