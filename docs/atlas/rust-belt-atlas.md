# Rust Belt Atlas

Rust Belt Atlas is the **scoring and clustering engine** for the Rust Belt project.  
It operates upstream of the Rust Belt Solver:

- **Atlas** maps the landscape — assigning Value/Yield scores, identifying metro anchors, and clustering stores.  
- **Solver** plans the journey — generating itineraries given a candidate set of stores.  

Together they form a connected workflow: Atlas charts, Solver routes.

---

## Purpose

Atlas answers two key questions:

1. **How promising is each store?**  
   - Computes per-store **Value** (payoff per item) and **Yield** (hit rate / reliability).  
   - Sources: baseline by store type, affluence signals, adjacency inference, and observed data.

2. **Where are the natural clusters?**  
   - Groups stores into **metro anchors** and **sub-clusters** based on geography and observed/desk-estimated scores.  
   - Anchors provide context for loop-style runs and for interpreting solver output.

---

## Inputs

- **Store list** (CSV/JSON): StoreId, type, lat/lon, optional metadata.  
- **Affluence data** (CSV/GeoJSON): census or neighborhood-level signals (income, housing value, turnover).  
- **Observations** (CSV/JSON): past visits with Value and Yield ratings.

---

## Outputs

- **Scored stores**: per-store Value, Yield, composite score, and an explanation trace.  
- **Anchors**: metro-level clusters with centroid, store count, and mean scores.  
- **Clusters**: sub-groups of stores within anchors for downstream Solver runs.  
- **Diagnostics**: correlation summaries, scatter plots of Value vs Yield, outlier detection.

---

## Role in the Rust Belt

Atlas does not replace the Solver. It complements it:

- **Atlas** = scoring + anchors + clusters (prospecting intelligence).  
- **Solver** = sequencing + routing (itinerary optimization).  

This separation keeps Solver lean and deterministic, while allowing Atlas to evolve independently as new scoring models and clustering strategies are tested.

---

## Roadmap

- **v0.1 (Prototype)**: Python implementation (pandas + geopandas). CLI for scoring and clustering, CSV/JSON I/O.  
- **v0.2 (Integration)**: Feed Atlas outputs into Solver as alternative to JScore.  
- **v0.3 (Expansion)**: Add richer affluence models, neighbor inference, and scenario comparisons.  

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
