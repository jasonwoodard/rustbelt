# Rust Belt Atlas

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.  
It operates upstream of the Rust Belt Solver:

- **Atlas** maps the landscape — assigning Value/Yield scores, identifying metro anchors, and clustering stores.  
- **Solver** plans the journey — generating itineraries given a candidate set of stores.  

Together they form a connected workflow: Atlas charts, Solver routes.

---

> **Need the latest update?** See the [Atlas v0.2 release notes](releases/v0.2.md) for CLI, diagnostics, and schema changes.

---

## Purpose

Atlas answers two key questions:

1. **How promising is each store?**  
   - Computes per-store **Value** (payoff per item) and **Yield** (time-normalized hit rate).  
   - Sources: type baselines, affluence signals, adjacency/neighbor smoothing, and observed data.

2. **Where are the natural clusters?**  
   - Groups stores into **metro anchors** and **sub-clusters** based on geography and Value/Yield signals.  
   - Anchors provide context for loop-style runs and for interpreting solver output.

---

## Modes

Atlas exposes three explicit scoring modes:

- **Prior-Only**  
  Use **desk priors** only (type baselines + affluence model). Best for cold start when no observations exist.

- **Posterior-Only**  
  Fit **from observations** (V, N, t) and **predict to unvisited stores** via regularized models and/or neighbor smoothing. No desk priors are used. Outputs include a credibility score.

- **Blended**
  Blend posterior predictions with priors via a shrinkage weight \( \omega \in [0,1] \):
  \( \widehat{E[V]} = \omega\,\widehat{E[V]_{\text{post}}} + (1-\omega)\,E[V]_{\text{prior}} \) and
  \( \widehat{E[\theta]} = \omega\,\widehat{E[\theta]_{\text{post}}} + (1-\omega)\,E[\theta]_{\text{prior}} \).

  Atlas records the configured or adaptive \( \omega \) together with its prior/posterior components for later auditing and diagnostics.

> Projection to a 1-D score for Solver (when requested) uses the canonical \( \text{VYScore}_\lambda = \lambda V + (1-\lambda)Y \), emitted in the `Composite` column when `--lambda` is set.

---

## Inputs

- **Store list** (CSV/JSON): `StoreId, Type, Lat, Lon, optional metadata (Name, Notes, JScore)`.  
- **Affluence data** (CSV/GeoJSON): ZIP/ZCTA signals (income, high-income %, renters %, population), normalized per metro.  
- **Observations** (CSV/JSON, optional): visit rows with `DwellMin (t), PurchasedItems (N), HaulLikert (H→V)` plus optional covariates like `ObserverId`, `Spend`, or qualitative `Notes`.
- **Config**: mode (`prior-only | posterior-only | blended`), lambda (harvest/balanced/explore), ECDF window (day/metro/trip/corpus).

---

## Outputs

- **Scored stores** (always, matching [`score.schema.json`](../../schema/atlas/v1/score.schema.json)):
  - `StoreId, Value, Yield, Composite (λ projection when requested)`
  - `Omega`, `ValuePrior`, `ValuePosterior`, `YieldPrior`, `YieldPosterior`
  - `Theta`, `Cred`, `Method`, `ECDF_q`

- **Anchors** (optional): metro-level clusters with `AnchorId, centroid, store count, mean Value, mean Yield`.

- **Sub-clusters** (optional): `ClusterId, AnchorId, members, centroid, mean Value, mean Yield`.

- **Diagnostics** (optional): correlation summaries, distributions, outlier detection.

> Solver can consume either the 2-D V/Y fields with a projection parameter, or a pre-projected 1-D score.

See the [Atlas CLI reference](./atlas-cli-reference.md) for command syntax, flag defaults, and full schema details.

---

## Role in the Rust Belt

Atlas does not replace the Solver. It complements it:

- **Atlas** = scoring + anchors + clusters (prospecting intelligence).  
- **Solver** = sequencing + routing (itinerary optimization).  

This separation keeps Solver lean and deterministic, while allowing Atlas to evolve independently as new scoring models and clustering strategies are tested.

---

## Roadmap

- **v0.1 (Prototype)**: Python implementation (pandas + geopandas). CLI for scoring; CSV/JSON I/O; expose blend weight & provenance fields (FR-1b).
- **v0.2 (Integration)**: Feed Atlas outputs into Solver as an alternative to JScore.  
- **v0.3 (Expansion)**: Add richer affluence models, neighbor inference, and scenario comparisons.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
