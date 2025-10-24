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
- **Observations (optional):** `DwellMin, PurchasedItems, HaulLikert` (→ V/Y) plus optional covariates (`ObserverId`, `Spend`, qualitative notes).
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
- Diagnostics sidecars (HTML, JSON, Parquet) summarising correlations, distributions, QA checks
- Posterior-only traces (`--posterior-trace`) and combined stage traces (`--trace-out`) for auditability

### Trace & diagnostics schema versioning

- Atlas emits structured trace rows for each scoring stage (`prior`, `posterior`, `blend`).
- Use the CLI flags `--trace-out`, `--posterior-trace`, and the `--include-*-trace` toggles to persist combined or stage-specific diagnostics.
- The flattened payload is versioned via `TRACE_SCHEMA_VERSION` (`packages/atlas-python/src/atlas/explain/trace.py`).
- Diagnostics artifacts are versioned through `DIAGNOSTICS_VERSION` (`packages/atlas-python/src/atlas/diagnostics/__init__.py`) and share the `atlas-diagnostics-v0.2` basename across formats.
- JSON Schema + canonical examples live at `schema/atlas/v1/trace.schema.json` and `schema/atlas/v1/trace-record.example.json`.
- Tests validate trace rows against the schema; bump the version when making breaking changes and update the docs/examples.

---

> **Atlas CLI v0.2 highlights:** scoring now emits diagnostics sidecars by default, anchors/sub-clusters ship as dedicated subcommands, and trace exports are configurable per stage with schema validation baked into every write.

## Atlas CLI quickstart

### Install dependencies

```bash
cd packages/atlas-python
pip install -e .
```

The editable install exposes the `rustbelt-atlas` entry point and keeps CLI changes in sync with repository sources.

### Sample datasets

Canonical dense urban fixtures live under `packages/atlas-python/src/atlas/fixtures/dense_urban/`. They mirror the Solver regression data in `fixtures/solver/atlas/` and are safe to regenerate locally.

### Score stores (prior, posterior, blended)

```bash
cd /workspace/rustbelt
PYTHONPATH=packages/atlas-python/src python -m atlas.cli score \
  --mode blended \
  --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
  --affluence packages/atlas-python/src/atlas/fixtures/dense_urban/affluence.csv \
  --observations packages/atlas-python/src/atlas/fixtures/dense_urban/observations.csv \
  --output out/atlas-cli/dense-urban-scores.csv \
  --lambda 0.5 \
  --trace-out out/atlas-cli/dense-urban-trace.jsonl \
  --posterior-trace out/atlas-cli/dense-urban-posterior-trace.csv \
  --diagnostics-dir out/atlas-cli/diagnostics
```

The CLI validates every payload against the score and trace schemas (`schema/atlas/v1`). Successful runs write:

- `dense-urban-scores.csv` – blended prior/posterior scores, including `Cred`, `Method`, ECDF quantiles, and composite columns.
- `atlas-diagnostics-v0.2.{html,json,parquet}` – correlation tables, distribution summaries, and QA flags (HTML/JSON/Parquet).
- `dense-urban-trace.jsonl` – combined stage traces controlled by `--include-prior-trace`, `--include-posterior-trace`, and `--include-blend-trace`.
- `dense-urban-posterior-trace.csv` – posterior-only rows in a wide format for detailed audits.

Disable diagnostics with `--no-diagnostics` or redirect the sidecars to a different directory via `--diagnostics-dir`.

### Detect anchors

```bash
PYTHONPATH=packages/atlas-python/src python -m atlas.cli anchors \
  --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
  --output out/atlas-cli/dense-urban-anchors.csv \
  --store-assignments out/atlas-cli/dense-urban-anchor-assignments.csv \
  --metrics out/atlas-cli/dense-urban-anchor-metrics.json \
  --algorithm dbscan \
  --eps 0.03 \
  --min-samples 2 \
  --metric euclidean \
  --id-prefix metro-anchor
```

Outputs include anchor centroids, store counts, optional assignments, and clustering diagnostics. JSON payloads are validated against `schema/atlas/v1/anchor.schema.json`.

### Materialise sub-clusters

```bash
PYTHONPATH=packages/atlas-python/src python -m atlas.cli subclusters \
  --anchor-id metro-anchor-001 \
  --spec fixtures/solver/atlas/dense-urban-subcluster-spec.json \
  --output out/atlas-cli/dense-urban-subclusters.jsonl \
  --id-prefix metro-anchor-001-sc
```

The command consumes a JSON spec describing hierarchy nodes and emits validated cluster rows under `schema/atlas/v1/cluster.schema.json`.

### Trace-only dry run

Pass `--explain` to `python -m atlas.cli` to emit small sample trace files (`atlas-trace.json`, `atlas-trace.csv`) without running the full pipelines—useful for wiring experiments and UI previews.

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
