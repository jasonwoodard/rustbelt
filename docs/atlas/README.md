# docs/atlas/README.md

# Rust Belt Atlas

Atlas is the **scoring and geo-structuring engine** for Rust Belt. It turns a list of stores and neighborhood context into **Value/ Yield** signals you can sort, compare, and (optionally) project to a single score for the Solver.

- **Value (V)** – how good the finds are (haul quality).
- **Yield (Y)** – how often worthwhile items are found per unit time (efficiency).

Atlas **does not** generate routes; the Solver does. Atlas **explains the landscape**; the Solver **plans the day**.

---

## Why Atlas exists

- Google ratings don’t predict thrift/antique outcomes.  
- Your JScore is a strong curation prior, but not decomposed.  
- Trips benefit from **context** (affluence, stability) and **observations** (post-visit truth).  
Atlas fuses these into a consistent, explainable V/Y view.

---

## What Atlas can do

1) **Score stores with no observations** (cold start)  
   Use ZIP-level affluence + store type to estimate V and Y. (Prior-Only mode)

2) **Learn from your visits**  
   Take (time, purchased items, haul rating) and predict to unvisited stores. (Posterior-Only mode)

3) **Blend both worlds**  
   Combine priors and posteriors with a shrinkage weight ω. (Blended mode)

4) **Optional projection**  
   When the Solver needs a single number:  
   `VYScore_λ = λ·V + (1−λ)·Y` with λ ∈ {0.8 harvest, 0.6 balanced, 0.4 explore}.

5) **Anchor & cluster** (optional)  
   Identify “pockets of goodness” (anchors) and nearby clusters to guide day design.

---

## Inputs

- **Stores:** `StoreId, Type, Lat, Lon, Zip` (+ optional `Name, JScore`)
- **Affluence (by ZIP/ZCTA):** `MedianIncome, PctHH_100kPlus, PctRenters, Population`
- **Observations (optional):** `DwellMin, PurchasedItems, HaulLikert` (→ V/Y)
- **Config:** mode (`prior-only | posterior-only | blended`), ECDF window, λ

---

## Outputs

Per store:
- `Value (V) [1–5]`
- `Theta_est` (items per 45m)
- `Yield (Y) [1–5]` (ECDF of θ)
- `ModeComposite (VYScore_λ)` when requested
- `Cred` (0–1 credibility) and `Method` (GLM|Hier|kNN|AnchorMean)
- `SourceTrace` (inputs & ECDF quantile for audit)

Optional:
- Anchors & clusters (centroids, stats)

---

## Modes (pick one)

- **Prior-Only**: affluence/type model → V/Y (no observations)
- **Posterior-Only**: fit from observations, predict to all stores (no priors)
- **Blended**: ω·posterior + (1−ω)·prior

---

## File map (start here)

- **VYScore (canonical math):** `docs/atlas/vy-whitepaper.md`, `docs/atlas/vy-data-dictionary.md`
- **Affluence model (priors):** `docs/atlas/rust-belt-atlas-affluence-model.md`
- **Atlas overview/spec:** `docs/atlas/rust-belt-atlas.md` (this file)
- **Functional requirements:** `docs/atlas/rust-belt-atlas-fr.md`
- **Tech plan & CLI:** `docs/atlas/rust-belt-atlas-tech-plan.md`
- **Flow & feedback loop:** `docs/atlas/rust-belt-atlas-flow.md`
- **Tests:** `docs/atlas/atlas-test-plan.md`

---

## Two core use cases (what Atlas returns)

1) **Stores + Demographics (no observations)** → ranked V/Y (+ optional single score)  
2) **Stores + Demographics + Observations** → ranked V/Y (posterior or blended), credibility attached

These outputs can be viewed as an ordered list and fed to the Solver unchanged.
