# Atlas Python Prototype

This package hosts the early Python implementation of the Rust Belt Atlas scoring engine.

## Installation prerequisites

- **Python**: 3.11 or newer (the prototype relies on `numpy`/`pandas` releases that require Python ≥3.11).
- **pip**: Any modern pip (v23+) that understands `pyproject.toml` builds.
- **Optional**: `python -m venv` (or another virtual environment manager) to isolate dependencies.
- **Platform**: Tested on macOS 13+ and Ubuntu 22.04+. Windows users should run under WSL2 for consistent path handling.

Ensure the repository has been cloned locally, then install the package in editable mode:

```bash
cd packages/atlas-python
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e .[dev]
```

## CLI overview

The CLI entry point is `rustbelt-atlas`. Three scoring modes are available:

| Mode | When to use it | Required inputs |
|------|----------------|-----------------|
| `prior-only` | No observation logs yet; rely on desk estimates + affluence priors. | `--stores`, `--affluence` (or pre-normalised columns) |
| `posterior-only` | You only trust observational data (ignore priors). | `--stores`, `--observations` |
| `blended` | Combine priors with observations using a shrinkage factor λ. | `--stores`, `--affluence`, `--observations`, optional `--lambda` |

The sample data under `src/atlas/fixtures/` lets you exercise each mode end-to-end.

### Example: prior-only desk scoring

```bash
rustbelt-atlas score \
  --mode prior-only \
  --stores src/atlas/fixtures/dense_urban/stores.csv \
  --affluence src/atlas/fixtures/dense_urban/affluence.csv \
  --output out/dense_prior.csv \
  --trace-out out/dense_prior_trace.json
```

This command produces `out/dense_prior.csv` with Value, Yield, and Composite columns for every store. The optional `--trace-out` flag emits a JSONL file listing the baseline, affluence, and adjacency terms that sum to each score.

### Example: posterior-only scoring

```bash
rustbelt-atlas score \
  --mode posterior-only \
  --stores src/atlas/fixtures/dense_urban/stores.csv \
  --observations src/atlas/fixtures/dense_urban/observations.csv \
  --ecdf-window Metro \
  --posterior-trace out/dense_posterior_diagnostics.parquet \
  --output out/dense_posterior.csv
```

Posterior mode fits against the observation log and predicts Value/Yield for all stores. When `--posterior-trace` is provided, the CLI persists per-store diagnostics (either the predictions themselves or aggregate fit summaries) to help validate acceptance criteria around posterior recovery.

### Example: blended scoring

```bash
rustbelt-atlas score \
  --mode blended \
  --stores src/atlas/fixtures/dense_urban/stores.csv \
  --affluence src/atlas/fixtures/dense_urban/affluence.csv \
  --observations src/atlas/fixtures/dense_urban/observations.csv \
  --lambda 0.6 \
  --output out/dense_blended.csv
```

Blended mode overlays posterior observations on top of priors. Any store with observed data adopts the posterior mean (FR-1 AC1), while unvisited stores retain prior scores (FR-1 AC2). If `--lambda` is supplied, the CLI recomputes the composite JScore `λ·Value + (1-λ)·Yield` before writing the results.

### Explaining scores and traces

- `--explain` writes a standalone pair of files (`atlas-trace.json` and `atlas-trace.csv`) that show how the prototype composes Value/Yield from priors. Use this for quick demos.
- `--trace-out` (prior) and `--posterior-trace` (posterior) persist detailed machine-readable traces for downstream QA or report generation.
- Output CSVs/Parquet files always include `StoreId`, `Value`, `Yield`, and—when λ is provided—`Composite`. Posterior runs also emit credibility and method metadata once the modeling layer lands.

### Cross-links to design documents

- **Functional requirements (v0.1)**: [`docs/atlas/rust-belt-atlas-fr.md`](../../docs/atlas/rust-belt-atlas-fr.md) lists per-feature acceptance criteria (e.g., FR-1 AC1–AC4 for scoring behaviour, FR-4 AC1–AC3 for explainability traces). Use the CLI outputs above to demonstrate each criterion is satisfied.
- **Technical plan**: [`docs/atlas/rust-belt-atlas-tech-plan.md`](../../docs/atlas/rust-belt-atlas-tech-plan.md) captures the architecture, module boundaries, and the working assumptions (Python-first prototype, data contract separation from Solver). Align new CLI features with those assumptions to preserve the contract between Atlas and Solver.

For broader modeling assumptions (data sufficiency, ethical guardrails), see Section 10 of [`docs/atlas/vy-whitepaper.md`](../../docs/atlas/vy-whitepaper.md).
