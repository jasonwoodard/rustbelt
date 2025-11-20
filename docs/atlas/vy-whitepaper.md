# The Value–Yield Framework for Store Discovery
### An Operational, Testable Model for Context-Aware Thrift/Antique Exploration

**Version:** Draft v1.0  
**Authors:** Rust Belt Project (Jason W. et al.)

---

## 1. Motivation

Conventional star ratings measure *customer satisfaction*, not *discovery efficiency*. In secondhand exploration (thrift/antique/vintage), the objective is **finding worthwhile items under time and travel constraints**. We need a model that:

- separates *how good the finds are* from *how frequently they occur*,
- links observed outcomes to contextual signals (e.g., local affluence, housing stability),
- stays explainable for users, yet extensible for statistical calibration and multi-observer data.

We formalize this as **Value (V)** and **Yield (Y)**.

---

## 2. Constructs and Time Basis

### 2.1 Value (V)
“**Quality of discovered items** given that discovery occurred.”  
Operationally: a 1–5 ordinal rating reflecting the observer’s haul quality (uniqueness, desirability, condition, price-to-value fit).

- **MVP proxy:** one Likert response per visit: $V \in \{1,\dots,5\}$.
- **Rationale:** V captures *intensity of goodness*; it should correlate with local wealth proxies (median income, % HH>\$100k), moderated by store type.

### 2.2 Yield (Y)
“**Rate of purchased worthwhile items per unit expected time.**”
Let $t$ be dwell time (minutes) and define a **nominal dwell** $t_0 = 45$ min (policy baseline). Let $N$ be the count of **items actually purchased** during the visit. (Spending is the threshold—if you bought it, it qualified.)

- **Latent rate:** $\theta$ items per $t_0$.
- **Observation model:**
  $$
  N \mid \theta, t \sim \text{Poisson}\!\big(\theta \cdot t/t_0 \big)
  $$
  (Negative Binomial alternative if overdispersed.)
- **MVP estimator:** $\hat{\theta} = \dfrac{N}{t/t_0}$.

**Score mapping (to [1,5]):** use a **monotone, dataset-relative** transform to preserve order and robustness:
$$
Y = 1 + 4 \cdot F_{\Theta}(\hat{\theta}),
$$
where $F_{\Theta}$ is the empirical CDF of $\hat{\theta}$ in the reference set (metro/day/corpus).

> **Interpretation:** Two stores with equal total purchases differ if one produces them in less time—Y rewards *efficiency*, not just count.

---

## 3. Data Collection (Minimal, High-Compliance)

Per visit, collect three fields (plus optional extras):

1) **Dwell minutes** $t$ (numeric).
2) **Purchased items** $N$ (integer).
3) **Haul quality** $H\in\{1,\dots,5\}$ (Likert).

Derived:
- $\hat{\theta} = N/(t/45)$ → **Yield rate** (items per $t_0$).
- $Y = 1 + 4\cdot \text{ECDF}(\hat{\theta})$ (or PERCENTRANK).
- $V = H$ (MVP; can upgrade to an ordinal model later).

**Optional (useful later):** total spend $S$, category tags, returns, observer id.

---

## 4. Contextual Predictors and Priors

Empirical analysis (Detroit/Ann Arbor sample) indicates:

- **Affluence ↑ ⇒ Value ↑** (Median income, %HH>\$100k show positive correlations).  
- **% Renters ↑ ⇒ Yield ↓** (negative correlation; stable, owner-occupied areas tend to “cast off” more and better goods).  
- Education and raw population showed weak, inconsistent relationships.

Encode as **priors** for unvisited stores, **by type**:

$$
\begin{aligned}
E[V \mid x] &= V_b(\text{type}) + \alpha_1 \cdot \text{Income}_{norm} + \alpha_2 \cdot \text{Pct100k}_{norm} + \epsilon_V \\
\log E[\theta \mid x] &= \beta_0(\text{type}) + \beta_1 \cdot \text{Income}_{norm} - \beta_2 \cdot \text{Renters}_{norm} + \epsilon_\theta
\end{aligned}
$$

- $V_b(\text{type})$, $\beta_0(\text{type})$ are **type baselines** (Thrift, Antique, Vintage).
- Signs follow the empirical correlations; magnitudes are fit from data.

**ZIP (ZCTA) vs Tract:** start at ZIP (practical for driving); upgrade to tracts if you need finer spatial signal. The model form is unchanged.

---

## 5. Estimation and Calibration

### 5.1 Yield
- **GLM (Poisson/NegBin):**
  $$
  N \sim \text{Poisson}\big( \exp(\eta)\cdot t/t_0 \big),\quad
  \eta = \beta_0(\text{type}) + \beta^\top x
  $$
  with $x$ including normalized affluence features.
  Use NegBin if overdispersion (check Pearson dispersion).

### 5.2 Value
- **Ordinal regression (ordered logit/probit):** $V \in \{1,\dots,5\}$ with thresholds $\tau_1<\dots<\tau_4$.
  Linear predictor $ \alpha_0(\text{type}) + \alpha^\top x $.

**Pragmatic MVP:** fit linear models first for interpretability; switch to ordinal + NegBin when samples enlarge.

### 5.3 Baselines by Type (priors)
Seed baselines from observed means and economic logic:

| Type    | $V_b$ | $Y_b$ | Notes |
|---------|--------:|--------:|-------|
| Thrift  | 2.8     | 3.4     | High turnover, moderate quality |
| Antique | 4.0     | 2.0     | High quality, low throughput |
| Vintage | 3.8     | 2.8     | Curated, boutique density |

(Replace with empirical estimates as data accrues.)

---

## 6. Composition for Decisions (Keep V and Y Separate Internally)

Keep V and Y distinct for analysis, and **only project** to a scalar when an algorithm requires it (e.g., routing):

$$
\text{VYScore}_\lambda = \lambda V + (1-\lambda) Y,\quad
\lambda \in \{0.8\ \text{Harvest},\ 0.6\ \text{Balanced},\ 0.4\ \text{Explore}\}.
$$

Optional single-number objective for economics:
$$
\text{EVH} \approx E[V]\cdot E[\theta]
\quad \text{(“value-points per 45 min”)}
$$
Use for ranking when you want a rate-adjusted quality scalar.

---

## 7. JScore and Observer Effects

- **JScore** (curation prior) is *exogenous* to V/Y; use it as a covariate for Value or as a tie-breaker.  
- **Single-observer mode (you):** observed $V,Y$ **override** priors for visited stores.
- **Multi-observer future:** add random intercepts per observer to capture calibration and reliability; normalize individual biases (per-observer z-scores) before aggregation.

---

## 8. Validation Strategy (Pre-registered, falsifiable)

### Hypotheses
- H-A: $\text{Income} \uparrow \Rightarrow V \uparrow$ (positive $\alpha_1$).
- H-B: $\text{% Renters} \uparrow \Rightarrow \theta \downarrow$ (negative $\beta_2$).
- H-C: Effects are **type-moderated** (Thrift $>$ Antique).
- H-D: VY-based predictions outperform Google ratings for in-field outcomes.

### Protocol
- **Split** by day/metro (e.g., fit on Detroit, test on Ann Arbor).
- **Report** signs, effect sizes, RMSE/MAE (Value), deviance $R^2$ (Yield), calibration curves.
- **Ablation:** remove affluence features, then remove type; measure degradation.
- **Robustness:** Winsorize extremes (e.g., spend per item), test NegBin vs Poisson.

---

## 9. Integration Blueprint

### Atlas (Context Engine)
- Inputs: store metadata, ZIP affluence, type; (optionally) past V/Y observations.  
- Outputs: $E[V]$, $E[\theta]$, and a projected scalar if requested.
- Roles: generate priors for unvisited stores; update with observations; identify spatial anchors/clusters.

### Solver (Routing)
- Inputs: 1-D scores only (e.g., $\text{VYScore}_\lambda$ or EVH), constraints (window, dwell, mph).
- Role: deterministic route optimization; explainable, free of scoring logic.

**Contract:** Atlas shapes the *value surface*; Solver navigates it.

### 9.1 Posterior-Only Inference
In cold-start or “no-priors” phases, VY serves as a posterior predictor: models trained on observed visits (V, N, t) produce out-of-sample predictions for unvisited stores using affluence covariates and/or neighbor smoothing. Predicted $\theta$ is mapped to $Y$ via the same ECDF as observations, preserving the operational 1–5 scale. Uncertainty is surfaced as a credibility score to guide exploitation vs exploration.

---

## 10. Assumptions, Limitations, Ethics

- **Assumptions:**  
  (i) Purchased item counts are approximately Poisson/NegBin;  
  (ii) Haul quality is ordinal and observer-consistent;  
  (iii) Affluence proxies (Median Income, % Renters) capture relevant donor dynamics.  
- **Limitations:**  
  Sparse visits; selection bias; ZIP is coarse; halo effects (time of day).  
- **Mitigations:**  
  Holdouts, hierarchical models, tract upgrade later, collect time-of-day and day-of-week.  
- **Ethics:**  
  Respect community impacts; avoid publishing personally identifiable donation patterns; aggregate/blur maps where necessary.

---

## 11. Worked Example (MVP Transform)

Visit row: $t=36$ min, $N=4$, $H=4$.
- $\hat{\theta} = 4 / (36/45) = 5.0$ items per 45 min.
- If the metro ECDF $F_{\Theta}(5.0)=0.78$, then $Y = 1 + 4\cdot 0.78 = 4.12$.
- $V = H = 4$.
- **Balanced projection:** $\text{VYScore}_{0.6} = 0.6\cdot 4 + 0.4\cdot 4.12 = 4.05$.

Explainable: “Above-average quality with a high rate per 45 minutes.”

---

## Appendix A — Variable & Field Dictionary (see companion doc for full dictionary)
- **Visit fields:** `StoreId, DateTime, Type, Zip, DwellMin (t), PurchasedItems (N), HaulLikert (H), Spend (S, optional), Notes (optional), ObserverId`  
- **Derived:** `ItemsPer45 = N/(t/45)`, `Y = 1 + 4*ECDF(ItemsPer45)`, `V = H`, `EVH = V*ItemsPer45`  
- **Affluence (by ZIP/ZCTA):** `MedianIncome, PctHH_100kPlus, PctRenters, Population` (normalized variants for modeling)

