# Atlas Scoring Algorithm Reference

## Title & Overview
Rust Belt Atlas ("Atlas") converts prior intelligence and field observations into reproducible 1–5 value and yield ratings for every store. This document enumerates the scoring logic so PMs and DS/ML reviewers can audit implementations without referencing code.

The reference covers desk priors, observational posterior models, blending policy, and the shared utilities (ECDF mapping, credibility, pooling, smoothing, dispersion fallback, and V–Y projection) used across scoring modes.

For CLI flag behaviour and schema contracts see the [Atlas CLI reference](./atlas-cli-reference.md).

## Global Notation
| Symbol | Meaning | Domain / Notes |
| --- | --- | --- |
| $i$ | Store index | — |
| $t_0$ | Nominal dwell minutes | 45 (constant) |
| $t_i$ | Observed dwell minutes | $t_i \ge 30$ for yield |
| $N_i$ | Items purchased | non-negative integer |
| $H_i$ | Haul Likert value | 1–5 |
| $\hat{\theta}_i$ | Observed item rate | items per 45 min |
| $F_\Theta$ | ECDF over $\hat{\theta}$ | windowed by config |
| $Y_i$ | Yield rating | 1–5 |
| $V_i$ | Value rating | 1–5 |
| $\lambda$ | V–Y projection weight | $[0,1]$ |
| $\omega$ | Blend weight | $[0,1]$ |
| $\kappa$ | Adaptive blend softness | $>0$ |
| $x_i$ | Feature vector | affluence + geo features |
| $\text{Cred}_i$ | Posterior credibility | $[0,1]$ |
| $\text{Method}_i$ | Provenance tag | GLM, Hier, kNN, AnchorMean, Observed |
| $\text{ECDF}_q$ | Quantile of $\hat{\theta}$ | $[0,1]$ |
| $\text{Composite}_i$ | λ-weighted projection | optional |
| $\text{Omega}_i$ | Blend weight | $[0,1]$ |
| $\text{ValuePrior}_i$ | Prior mean of Value | — |
| $\text{ValuePosterior}_i$ | Posterior mean of Value | — |
| $\text{YieldPrior}_i$ | Prior mean of Yield | — |
| $\text{YieldPosterior}_i$ | Posterior mean of Yield | — |

## Algorithms by Mode

### Prior-Only
Purpose: apply type baselines and affluence adjustments when no observations exist.

| Step | Plain English | Math |
| --- | --- | --- |
| `ingest_store_master` | Load stores and ensure mandatory columns are present. | — |
| `join_affluence` | Attach normalized affluence fields via ZIP. | — |
| `attach_type_baselines` | Fetch desk priors $V_b(\text{type}), \theta_b(\text{type}), Y_b(\text{type})$. | — |
| `apply_affluence_adjustments` | Adjust prior value/yield using linear coefficients. | $V_i = V_b + \alpha_1 I_i + \alpha_2 P_i$; $Y_i = Y_b - \beta_1 R_i$ |
| `derive_prior_theta` | Convert prior yield anchor into rate estimate. | $\theta^{\text{prior}}_i = \theta_b(\text{type})$ |
| `clamp_bounds` | Keep value and yield within 1–5. | $V_i, Y_i \leftarrow \text{clip}_{[1,5]}(\cdot)$ |
| `project_vy` | Compute optional blended score if requested. | $\text{Composite}_\lambda = \lambda V_i + (1-\lambda) Y_i$ |
| `emit_output` | Emit per-store prior record and trace provenance. | — |

**Parameters & Defaults**
- Desk priors table version `desk_priors_v4` (2024-02).
- Affluence coefficients: $\alpha_1 = 0.5$, $\alpha_2 = 0.3$, $\beta_1 = 0.4$.
- Type baselines (excerpt): Thrift $V_b=3.2$, $Y_b=2.9$, $\theta_b=2.4$; Vintage $V_b=3.6$, $Y_b=3.1$, $\theta_b=2.8$.
- Defaults: `lambda=0.6`, `ecdf-window=metro` (for later mapping), `t_min=30` minutes.

**Edge Cases & Checks**
- Missing ZIP → flag `Method=AnchorMean`, `Cred=0`, and source trace `missing_zip`.
- If normalized affluence is unavailable, fall back to type baseline (no adjustments).
- Clamp and round to 2 decimals deterministically; seed hash with store id for reproducible ordering.
- Persist config header (mode, lambda, priors version) for reproducibility.

### Posterior-Only
Purpose: estimate value and yield directly from observations using statistical models and pooling.

| Step | Plain English | Math |
| --- | --- | --- |
| `ingest_observations` | Load visits; remove rows with invalid dwell or counts. | drop if $t_i<30$ or $N_i<0$ |
| `compute_theta_hat` | Convert each observation to a rate per 45 minutes. | $\hat{\theta}_{i,v} = N_{i,v} / (t_{i,v}/t_0)$ |
| `winsorize_theta` | Limit extreme rates before modeling. | percentile clip 1–99% |
| `fit_glm_yield` | Fit Poisson GLM with type offsets; swap to NegBin if dispersed. | $\log \mu_{i,v} = \log (t_{i,v}/t_0) + \beta_0^{(\text{type})} + \beta^\top x_{i,v}$ |
| `predict_theta_post` | Derive posterior rate estimate per store. | $\hat{\theta}_i^{\text{post}} = \exp(\beta_0^{(\text{type})} + \beta^\top x_i)$ |
| `fit_value_model` | Regress value on features with type intercepts. | $\hat{V}_i^{\text{post}} = \alpha_0^{(\text{type})} + \alpha^\top x_i$ |
| `hier_pool_backfill` | Partially pool sparse stores toward type/anchor means. | see Hierarchical pooling subroutine |
| `knn_smooth_backfill` | Smooth unvisited stores via kNN kernel weights. | see kNN subroutine |
| `map_theta_to_yield` | Convert $\hat{\theta}$ into 1–5 yield via ECDF. | $Y_i = 1 + 4 F_\Theta(\hat{\theta}_i^{\text{post}})$ |
| `compute_credibility` | Translate uncertainty into Cred score. | see Credibility subroutine |
| `tag_method` | Label dominant contributor (GLM, Hier, kNN, Observed). | — |
| `emit_output` | Emit posterior metrics with ECDF quantile and trace. | — |

**Parameters & Defaults**
- Dwell minimum = 30 min; t0 = 45 min.
- `ecdf-window=metro` (others: day, trip, corpus).
- GLM covariates: `(Income_norm, Pct100k_norm, Renters_norm, lat, lon, Type one-hot)`.
- Dispersion threshold: NegBin fallback if Pearson dispersion > 1.5.
- kNN: `k=7`, kernel bandwidth `h` = median pairwise feature distance.
- Credibility: $\text{Cred} = 1/(1+\text{CV})$ with $\text{CV}$ from posterior SE / mean.

**Edge Cases & Checks**
- Drop duplicate visits per observer/date; log decision in the stage trace output.
- If ECDF window lacks support (<25 samples), fall back to `corpus` window and annotate.
- Deterministic randomness: fix seed 11 for GLM and bootstrapping.
- If GLM fails to converge, revert to hierarchical mean and set `Method=Hier`.
- Ensure predicted $V, Y$ clipped to [1,5]; set `Cred=0` when using pure anchor mean.

### Blended
Purpose: merge prior and posterior estimates using global or adaptive weights.

| Step | Plain English | Math |
| --- | --- | --- |
| `align_inputs` | Inner join prior and posterior frames by StoreId. | — |
| `choose_omega` | Select blend weights per config (global or adaptive). | $\omega_{i,m} = \begin{cases} \omega & \text{global}\\ \frac{\text{Cred}_i}{\text{Cred}_i+\kappa} & \text{adaptive}\end{cases}$ |
| `blend_value` | Combine prior/posterior value expectations. | $V_i^{\text{blend}} = \omega_{i,V} V_i^{\text{post}} + (1-\omega_{i,V}) V_i^{\text{prior}}$ |
| `blend_theta` | Combine rate estimates then recompute yield. | $\hat{\theta}_i^{\text{blend}} = \omega_{i,\theta} \hat{\theta}_i^{\text{post}} + (1-\omega_{i,\theta}) \hat{\theta}_i^{\text{prior}}$ |
| `remap_yield` | Map blended rate through ECDF to obtain final yield. | $Y_i^{\text{blend}} = 1 + 4 F_\Theta(\hat{\theta}_i^{\text{blend}})$ |
| `project_vy` | Optionally compute $\text{Composite}_\lambda$. | same as prior |
| `emit_components` | Output prior/posterior components, omega, and provenance. | — |

**Parameters & Defaults**
- `omega-mode=global`, `omega=0.7` (per-dimension identical).
- Adaptive default $\kappa = 0.3$; set floor $\omega_{i,m} \in [0.05, 0.95]$.
- Blended output retains posterior `Cred` unless overruled by rules (e.g., missing posterior → `Cred=0`).

**Edge Cases & Checks**
- If store missing posterior → copy prior values, set $\omega=0$, `Method=AnchorMean`.
- If store missing prior → block scoring and raise error (priors are mandatory baseline).
- Recompute ECDF using same window id as posterior to maintain comparability.
- Audit `Omega` rounding (2 decimals) and persist config in header for determinism.

## Shared Subroutines

### Yield Rate & ECDF Mapping
| Step | Plain English | Math |
| --- | --- | --- |
| `calc_theta_hat` | Convert observation to normalized rate. | $\hat{\theta} = N / (t/t_0)$ |
| `winsorize_rates` | Limit extremes before ECDF. | percentile clip |
| `build_ecdf` | Construct ECDF within requested window. | $F_\Theta(x) = \frac{1}{M} \sum_{m=1}^M \mathbf{1}(\hat{\theta}_m \le x)$ |
| `map_to_yield` | Scale quantile to 1–5 yield. | $Y = 1 + 4 F_\Theta(\hat{\theta})$ |
| `record_quantile` | Persist quantile for auditability. | `ECDF_q = F_\Theta(\hat{\theta})` |

### Credibility Calculation
| Step | Plain English | Math |
| --- | --- | --- |
| `compute_posterior_se` | Collect posterior standard error or surrogate. | — |
| `calc_cv` | Convert to coefficient of variation. | $\text{CV} = \text{SE}/\hat{m}$ |
| `map_to_cred` | Translate CV to 0–1 credibility. | $\text{Cred} = 1/(1+\text{CV})$ |
| `apply_caps` | Enforce numeric stability. | $\text{Cred} \leftarrow \text{clip}_{[0,1]}(\cdot)$ |
| `tag_source` | Store driver of Cred (GLM, Hier, kNN). | — |

### Hierarchical Pooling
| Step | Plain English | Math |
| --- | --- | --- |
| `group_by_type_anchor` | Collect stores under type/anchor clusters. | — |
| `estimate_level_means` | Compute group-level posterior means. | $\bar{m}_g = \frac{\sum w_i m_i}{\sum w_i}$ |
| `compute_shrinkage` | Determine partial pooling weight per store. | $\phi_i = \frac{\tau^2}{\tau^2 + \sigma_i^2}$ |
| `blend_store_group` | Mix store estimate with group mean. | $m_i^{\text{hier}} = \phi_i m_i + (1-\phi_i) \bar{m}_g$ |
| `update_method_flag` | Mark store as `Hier` if pooling dominates. | if $\phi_i < 0.5$ |

### kNN / Kernel Smoothing
| Step | Plain English | Math |
| --- | --- | --- |
| `build_feature_matrix` | Assemble standardized features for distance metric. | — |
| `find_neighbors` | Identify k nearest stores with observations. | $\text{NN}_i = \text{kNN}(x_i, k)$ |
| `compute_kernel_weights` | Weight neighbors using Gaussian kernel. | $w_j = \exp(-d_{ij}^2/h^2)$ |
| `normalize_weights` | Ensure weights sum to one. | $\tilde{w}_j = w_j / \sum_{k} w_k$ |
| `smooth_metric` | Produce smoothed estimate. | $m_i^{\text{kNN}} = \sum_{j \in \text{NN}_i} \tilde{w}_j m_j$ |

### NegBin Fallback Logic
| Step | Plain English | Math |
| --- | --- | --- |
| `calc_pearson_dispersion` | Measure overdispersion of Poisson GLM. | $D = \frac{1}{df} \sum \frac{(y - \hat{y})^2}{\hat{y}}$ |
| `check_threshold` | Compare against threshold 1.5. | if $D > 1.5$ |
| `refit_negbin` | Refit using Negative Binomial with log link. | $\log \mu = \log (t/t_0) + X\beta$ |
| `extract_theta` | Produce rate predictions from NegBin model. | same as GLM |
| `flag_method` | Annotate `Method=GLM` and mark `negbin` in trace metadata. | — |

### Projection to 1-D (Composite_$\lambda$)
| Step | Plain English | Math |
| --- | --- | --- |
| `select_lambda` | Choose projection weight based on config. | $\lambda \in \{0.8, 0.6, 0.4\}$ |
| `compute_score` | Combine value and yield into a single metric. | $\text{Composite}_\lambda = \lambda V + (1-\lambda) Y$ |
| `record_trace` | Log lambda and components in metadata. | — |

## Worked Example (Metro: River City)
| Input | Value |
| --- | --- |
| Store Type | Thrift |
| Normalized Income $I$ | 0.85 |
| Normalized %HH \$100k+ (P) | 0.72 |
| Normalized Renters $R$ | 0.30 |
| Observation | $t=45$ min, $N=3$, $H=4$ |
| ECDF Window | metro |

**Prior-Only**
- $V_b=3.2$, $Y_b=2.9$, $\theta_b=2.4$.
- $V^{\text{prior}} = 3.2 + 0.5(0.85) + 0.3(0.72) = 3.84$.
- $Y^{\text{prior}} = 2.9 - 0.4(0.30) = 2.78$.
- $\theta^{\text{prior}} = 2.4$ items/45m.
- $\text{Composite}_{0.6} = 0.6(3.84) + 0.4(2.78) = 3.42$.

**Posterior-Only**
- $\hat{\theta} = 3/(45/45) = 3.00$ items/45m (winsorized unchanged).
- ECDF quantile (metro window) $F_\Theta(3.00) = 0.68$ → $Y^{\text{post}} = 1 + 4(0.68) = 3.72$.
- Value regression $\hat{V}^{\text{post}} = 3.60$ (GLM with type intercept).
- Credibility: posterior CV = 0.35 → $\text{Cred} = 1/(1+0.35) = 0.74$.
- Method = GLM; trace metadata includes visit ids and ECDF window.

**Blended (global $\omega=0.7$)**
- $V^{\text{blend}} = 0.7(3.60) + 0.3(3.84) = 3.67$.
- $\hat{\theta}^{\text{blend}} = 0.7(3.00) + 0.3(2.40) = 2.82$.
- ECDF quantile $F_\Theta(2.82) = 0.63$ → $Y^{\text{blend}} = 1 + 4(0.63) = 3.52$.
- $\text{Composite}_{0.6}^{\text{blend}} = 0.6(3.67) + 0.4(3.52) = 3.60$.
- Omega reported as 0.70 (value and theta), Cred retained 0.74, Method = GLM (blended).

## Appendix A: Pseudocode
```text
function score_prior_only(stores, affluence, config):
    priors <- load_desk_priors(config.prior_version)
    ecdf_prior <- build_prior_ecdf_if_available()
    for store in stores:
        if missing(store.zip):
            emit_anchor_mean(store)
            continue
        a <- affluence[store.zip]
        V <- priors.V_baseline[store.type] + alpha1 * a.income_norm + alpha2 * a.pct100k_norm
        Y <- priors.Y_baseline[store.type] - beta1 * a.renters_norm
        theta <- priors.theta_baseline[store.type]
        V <- clamp(V, 1, 5)
        Y <- clamp(Y, 1, 5)
        record <- {
            StoreId: store.id,
            Value: V,
            Yield: Y,
            Theta: theta,
            Cred: 0,
            Method: "AnchorMean",
            ECDF_q: ecdf_prior.quantile(theta),
            ValuePrior: V,
            YieldPrior: Y,
            Omega: 0
        }
        if config.lambda:
            record.Composite <- config.lambda * V + (1 - config.lambda) * Y
        emit(record)

function score_posterior_only(stores, observations, affluence, config):
    obs <- filter_invalid_visits(observations, dwell_min=30)
    obs.theta_hat <- winsorize(N / (dwell / t0))
    model <- fit_glm(obs, features=affluence+geo, offset=log(dwell/t0))
    if pearson_dispersion(model) > 1.5:
        model <- fit_negbin(obs, ...)
    value_model <- fit_value_regression(obs, features)
    ecdf <- build_ecdf(obs.theta_hat, window=config.ecdf_window)
    for store in stores:
        if has_observations(store):
            theta_post <- predict(model, store.features)
            value_post <- predict(value_model, store.features)
            theta_post <- winsorize(theta_post)
            yield_post <- map_to_yield(ecdf, theta_post)
            cred <- credibility(theta_post, store)
            method <- derive_method_flag(store)
        else:
            theta_post, value_post, yield_post, cred, method <- backfill_with_hier_knn(store)
        record <- {
            StoreId: store.id,
            Value: value_post,
            Yield: yield_post,
            Theta: theta_post,
            Cred: cred,
            Method: method,
            ECDF_q: ecdf.quantile(theta_post),
            ValuePosterior: value_post,
            YieldPosterior: yield_post
        }
        if config.lambda:
            record.Composite <- config.lambda * value_post + (1 - config.lambda) * yield_post
        emit(record)

function score_blended(prior_df, posterior_df, config):
    merged <- join(prior_df, posterior_df, on=StoreId)
    for row in merged:
        omega_value <- choose_omega(row.Cred, config, dimension="value")
        omega_theta <- choose_omega(row.Cred, config, dimension="theta")
        value_blend <- omega_value * row.ValuePosterior + (1 - omega_value) * row.ValuePrior
        theta_blend <- omega_theta * row.ThetaPosterior + (1 - omega_theta) * row.ThetaPrior
        yield_blend <- map_to_yield(ecdf_window=config.ecdf_window, theta=theta_blend)
        if config.lambda:
            vy_blend <- config.lambda * value_blend + (1 - config.lambda) * yield_blend
        record <- {
            StoreId: row.StoreId,
            Value: value_blend,
            Yield: yield_blend,
            Theta: theta_blend,
            Cred: row.Cred,
            Method: row.Method,
            ECDF_q: ecdf.quantile(theta_blend),
            Omega: omega_theta,
            ValuePrior: row.ValuePrior,
            ValuePosterior: row.ValuePosterior,
            YieldPrior: row.YieldPrior,
            YieldPosterior: row.YieldPosterior
        }
        if config.lambda:
            record.Composite <- vy_blend
        emit(record)
```

## Appendix B: Glossary
- **V**: Final 1–5 value rating per store.
- **$\theta$**: Item rate normalized to 45 minutes.
- **ECDF_q**: Quantile from the empirical CDF of $\hat{\theta}$.
- **Y**: Yield rating derived from $\theta$ via ECDF mapping.
- **$\omega$**: Blend weight between posterior and prior estimates.
- **$\lambda$**: Weight used to project Value and Yield into a single score.
- **Cred**: Credibility score reflecting posterior confidence.
- **Method**: Provenance tag summarizing the dominant estimation path.

## Appendix C: References
- `docs/atlas/vy-whitepaper.md`
- `docs/atlas/vy-data-dictionary.md`
- `docs/atlas/rust-belt-atlas-affluence-model.md`
- `docs/atlas/rust-belt-atlas-fr.md`
- `docs/atlas/atlas-test-plan.md`
- `docs/atlas/USER-GUIDE.md`
- `docs/atlas/README.md`
