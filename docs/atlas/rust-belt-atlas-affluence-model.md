# Rust Belt Atlas – Affluence Model Specification (v0.1)

The **Affluence Model** defines how Atlas converts demographic signals into
Value–Yield score adjustments for unvisited stores.

It supplements baseline priors by *store type* with measurable
economic context derived from U.S. Census ACS data at the ZIP Code Tabulation Area (ZCTA) level.

---

## 1. Purpose

Observed trip data shows that store performance correlates with local affluence and housing stability:

| Variable        | Global Corr. | Interpretation                          |
|------------------|-------------:|-----------------------------------------|
| Median Income     | +0.36        | Higher affluence → higher store quality |
| % ≥ \$100k HH     | +0.35        | Same as above                            |
| % Renter          | –0.45        | Higher renter share → lower yield reliability |

When segmented by store type, these effects strengthen or weaken, motivating **type-aware weighting**.

---

## 2. Data Inputs

| Column             | Source Table         | Description                         |
|---------------------|----------------------|-------------------------------------|
| `MedianIncome`      | B19013               | Median household income             |
| `PctHH_100kPlus`    | Derived from B19001   | % households with income > \$100k   |
| `PctRenter`         | Derived from B25003    | % renter-occupied housing units     |
| `Population`        | B01003               | Total population (for scaling)      |

All values are joined to stores by ZIP (ZCTA5).

---

## 3. Normalization

Each affluence variable is rescaled to a 0–1 range within the active metro:

\[
x_{\text{norm}} = \frac{x - x_{\min}}{x_{\max} - x_{\min}}
\]

This ensures comparability across metros with different economic baselines.

---

## 4. Type-Aware Baselines

Each store type begins with baseline priors for Value and Yield.

| Type     | BaseValue | BaseYield | Notes                               |
|----------|----------:|-----------:|--------------------------------------|
| Thrift   | 2.8       | 3.4        | High volume, moderate quality         |
| Antique  | 4.0       | 2.0        | Low yield, high value potential       |
| Vintage  | 3.8       | 2.8        | Curated, lower density                |
| Flea/Surplus | 3.0  | 3.0        | Neutral starting point                |
| Unknown  | 3.0       | 3.0        | Default fallback                      |

---

## 5. Affluence Adjustments

For each store \( s \):

\[
V_s = V_b + \alpha_1 \cdot \text{MedianIncome}_{\text{norm}} + \alpha_2 \cdot \text{PctHH\_100kPlus}_{\text{norm}}
\]
\[
Y_s = Y_b - \beta_1 \cdot \text{PctRenter}_{\text{norm}}
\]

### Recommended Coefficients

| Type     | α₁ (Income) | α₂ (High-Income HH) | β₁ (Renter) |
|----------|------------:|--------------------:|------------:|
| Thrift   | +0.5        | +0.5                | –0.5         |
| Antique  | +0.1        | +0.1                | –0.1         |
| Vintage  | +0.5        | +0.3                | –1.0         |
| Flea/Surplus | +0.2   | +0.2                | –0.3         |

Coefficients represent directional influence derived from correlation analysis (v0.1 dataset).

---

## 6. Composite Score (Optional)

To reduce to a single metric for tooling or Solver compatibility:

\[
J_s = \lambda \cdot V_s + (1 - \lambda) \cdot Y_s
\]

Default: \( \lambda = 0.6 \) (favor Value slightly).

---

## 7. Outputs

Each store record receives:

| Field        | Description                           |
|--------------|----------------------------------------|
| `StoreId`     | Unique store identifier                |
| `Type`        | Store type (Thrift / Antique / etc.)  |
| `Value`       | Adjusted Value score                  |
| `Yield`       | Adjusted Yield score                  |
| `Composite`   | Optional JScore                        |
| `SourceTrace` | JSON explanation of contributing factors|

---

## 8. Example

**Example Store (Thrift, ZIP 48009)**  
Let’s say:
- `MedianIncome_norm = 0.95`
- `PctHH_100kPlus_norm = 0.90`
- `PctRenter_norm = 0.20`

Using Thrift coefficients:
\[
V = 2.8 + (0.5 \times 0.95) + (0.5 \times 0.90) = 3.75
\]
\[
Y = 3.4 - (0.5 \times 0.20) = 3.30
\]

Thus:
\[
J = 0.6 \times 3.75 + 0.4 \times 3.30 = 3.57
\]

---

## 9. Future Extensions

- Move from ZIP (ZCTA) to Census Tract granularity for sharper spatial context.  
- Incorporate additional predictors: retail density, housing turnover, donor base indicators.  
- Re-fit coefficients based on cumulative observation dataset (Bayesian updates).  
- Introduce per-metro normalization bands to compare cross-region scores fairly.

---

## 10. Posterior-Only Prediction (No Priors)

When affluence priors are unavailable or intentionally disabled, Atlas estimates scores solely from observations and propagates to unvisited stores.

### Models
- **Yield (rate θ)**: Poisson/NegBin GLM on counts N with offset log(t/t₀); predictors use normalized affluence features and type intercepts when available. If data are sparse, fall back to hierarchical partial pooling or k-NN smoothing over (Income_norm, Renters_norm, lat, lon, type).
- **Value (V)**: Linear/OLS on V for MVP; upgrade to ordered logit as sample grows.

### Mapping to Y
Predict θ and map to Y via the same ECDF used for observed θ̂ in the chosen reference window.

### Credibility
Emit `Cred ∈ [0,1]` from prediction uncertainty (e.g., 1 − normalized SE). Low Cred should be surfaced to the user and/or down-weighted for Solver.

---

*Rust Belt Atlas maps the landscape; Rust Belt Solver plans the journey.*
