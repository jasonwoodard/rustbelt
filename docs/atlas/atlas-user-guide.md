# docs/atlas/USER-GUIDE.md

# Atlas – User Guide (Plain Language)

Atlas helps you decide **where the good stores probably are** and **how to prioritize them** before you ever route the day.

- **Value (V):** how good the “haul” felt (1–5).
- **Yield (Y):** how fast you found buy-worthy items, adjusted for time (1–5).

> Looking for the newest CLI and artifact updates? Read the [Atlas v0.2 release notes](releases/v0.2.md).
> Need the authoritative flag list and schemas? See the [Rust Belt Atlas CLI Reference](./rust-belt-atlas-cli-reference.md).

You can keep V and Y separate, or press a button to combine them into one number for routing.

---

## What you give Atlas

- A CSV/JSON of **stores** (id, type, lat/lon, ZIP).  
- A CSV of **ZIP demographics** (median income, % renters, etc.).  
- Optional **visit notes** from the field (time in store, how many items you bought, how good the haul felt).

That’s it.

---

## What Atlas gives back

For each store, Atlas returns:
- **V (1–5):** predicted or observed haul quality  
- **Y (1–5):** predicted or observed efficiency (finds per 45 minutes)  
- **Credibility (0–1):** how confident the estimate is  
- **Why:** a short explanation (which signals drove the score)

You can sort by V, Y, or combine them (see “Modes” below).

---

## Modes you can run

- **Prior-Only:** You have no visits. Atlas uses neighborhood data (income, renter %) + store type to estimate V and Y.  
- **Posterior-Only:** You have visit notes. Atlas learns from them and predicts the rest.  
- **Blended:** You want both: observations matter most, but neighborhood still nudges.

---

## Quickstart: run Atlas v0.2 with sample data

1. **Install the prototype** (once per machine):
   ```bash
   cd packages/atlas-python
   python -m venv .venv
   source .venv/bin/activate
   pip install -e .[dev]
   ```
2. **Clone the sample metro**: the repository already ships with synthetic fixtures under `packages/atlas-python/src/atlas/fixtures/`. Use the `dense_urban` folder for a high-signal dataset.
3. **Score with desk priors** to baseline Value/Yield before any visits:
   ```bash
   rustbelt-atlas score \
     --mode prior-only \
     --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
     --affluence packages/atlas-python/src/atlas/fixtures/dense_urban/affluence.csv \
     --output out/dense_prior.csv \
     --trace-out out/dense_prior_trace.jsonl
   ```
   Check the CSV to see 1–5 Value/Yield scores and the JSONL trace to understand how the prior was assembled (baseline + affluence).
4. **Fit the posterior** once you have visit notes:
   ```bash
   rustbelt-atlas score \
     --mode posterior-only \
     --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
     --observations packages/atlas-python/src/atlas/fixtures/dense_urban/observations.csv \
     --ecdf-window Metro \
     --posterior-trace out/dense_posterior_diagnostics.csv \
     --output out/dense_posterior.csv
   ```
   Confirm the visited stores recover their observed Value/Yield (FR-1a AC1) and that unvisited stores still receive predictions with method + credibility fields (FR-1a AC2).
5. **Blend** the two perspectives when you are ready to route:
   ```bash
   rustbelt-atlas score \
     --mode blended \
     --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
     --affluence packages/atlas-python/src/atlas/fixtures/dense_urban/affluence.csv \
     --observations packages/atlas-python/src/atlas/fixtures/dense_urban/observations.csv \
     --lambda 0.6 \
     --output out/dense_blended.csv
   ```
   The blended file keeps posterior means for visited stores while filling gaps with priors and recomputing the λ-weighted composite score.
6. **Inspect the outputs**:
   - Score exports (`out/dense_prior.csv`, `out/dense_posterior.csv`, `out/dense_blended.csv`): Value/Yield (and optional Composite) per store.
   - Traces (`out/dense_prior_trace.jsonl`, optional `out/dense_posterior_diagnostics.csv` when you pass `--posterior-trace`): machine-readable records of how priors and posteriors were assembled.
   - Diagnostics (`out/atlas-diagnostics-v0.2.{json,html,parquet}`): richer QA bundles emitted alongside posterior traces for dashboards and reports.
   - Re-run with `--explain` for a lightweight sample trace (`atlas-trace.json` / `atlas-trace.csv`).

Re-run the commands with the `sparse_rural` fixtures to see how the engine behaves with minimal observations and heavier reliance on priors.

### Map dense or sparse neighborhoods with anchors and sub-clusters

Use the built-in fixtures to learn the anchor/sub-cluster workflows before running them on your own metro. The examples below write outputs to `out/` so you can inspect them alongside your scoring runs.

1. **Find anchors (DBSCAN):** good for tighter metros where distances are consistent.
   ```bash
   rustbelt-atlas anchors \
     --stores packages/atlas-python/src/atlas/fixtures/dense_urban/stores.csv \
     --algorithm dbscan \
     --eps 0.003 \
     --min-samples 5 \
     --output out/dense_anchors.csv
   ```
   - **`--eps`**: pick a maximum neighbor distance in degrees; start around 0.002–0.004 for dense metros and increase only if clusters look over-split. If you see one giant cluster, lower it.
   - **`--min-samples`**: raise this (e.g., 8–10) to require more evidence before declaring an anchor; lower it (3–4) when you expect sparse retail.
   - **Output routing:** pass `out/dense_anchors.csv` into `rustbelt-atlas score --affluence ... --anchors out/dense_anchors.csv` to let the scoring stage weight stores near strong anchors higher, or load it into your diagnostics notebooks to visualize where Atlas thinks the retail gravity points are.

2. **Find sub-clusters (HDBSCAN):** better when store spacing changes a lot across the metro.
   ```bash
   rustbelt-atlas subclusters \
     --stores packages/atlas-python/src/atlas/fixtures/sparse_rural/stores.csv \
     --algorithm hdbscan \
     --min-samples 4 \
     --min-cluster-size 6 \
     --output out/rural_subclusters.csv
   ```
   - Prefer **`hdbscan`** when density varies block-to-block or you are mixing suburbs and city cores. Stick with **`dbscan`** when the street grid is uniform and you want predictable distances.
   - Tune **`--min-samples`** the same way as anchors; use **`--min-cluster-size`** to filter out tiny clusters that are not worth a dedicated stop.
   - **Output routing:** feed `out/rural_subclusters.csv` to the scorer with `--subclusters out/rural_subclusters.csv` to nudge Value/Yield toward promising pockets, or ship the file into diagnostics to see which pockets are driving high scores.

3. **Quick sanity loop:**
   - Start with `dense_urban` fixtures and `dbscan` to learn how changing `--eps` splits or merges anchors.
   - Switch to `sparse_rural` fixtures and `hdbscan` to see how the algorithm adapts to uneven spacing without hand-tuning `--eps`.
   - Keep the best anchor/sub-cluster file next to your scoring outputs so routing has both the **where** (clusters) and the **how good** (scores).

### Trace output switches

- `--trace-out PATH` writes a combined trace for whichever scoring stages ran. Priors, posteriors, and blend rows are included by default.
- Toggle specific stages with `--no-include-prior-trace`, `--no-include-posterior-trace`, or `--no-include-blend-trace` when you only need a subset (for example, blend-only QA dumps).
- Choose the combined trace format with `--trace-format {jsonl,csv}`. The flag controls the serializer regardless of filename suffix.
- `--posterior-trace PATH` emits posterior-only traces (`.csv` by default, switchable via `--posterior-trace-format {jsonl,csv}`) and writes the `atlas-diagnostics-v0.2.{json,html,parquet}` sidecars in the same directory. Posterior rows are still included in the combined trace unless you disable them with `--no-include-posterior-trace`.

---

## Minimal data to record after each store

Answer **three questions**:
1) **How long** did you stay? (minutes)  
2) **How many items** did you buy? (count)  
3) **How good was the haul** overall? (1–5)

Atlas converts that to V and Y automatically.

---

## How V and Y are used

- **V** is your haul quality (1–5).  
- **Y** is your rate: items per 45 minutes, mapped to 1–5 relative to the city/day.  
- To make a single number (for routing):  
  `VYScore_λ = λ·V + (1−λ)·Y`  
  - **Harvest (λ=0.8):** favor quality days (antiques, curated vintage)  
  - **Balanced (λ=0.6):** even  
  - **Explore (λ=0.4):** favor high-throughput thrift

---

## Typical workflow

1) Load stores + ZIP demographics → run **Prior-Only** → get a first ranked list.  
2) Visit a few stores; log time, items bought, and haul quality.  
3) Re-run Atlas in **Posterior-Only** → watch unvisited stores re-order.  
4) When ready, switch to **Blended** to mix in the ZIP context carefully.  
5) Send the single score to the Solver when you want a route.

---

## FAQ

**Do I have to combine V and Y?**  
No. Keep them separate for analysis. Only combine when the Solver needs one number.

**Is Google star rating used?**  
Not directly. It doesn’t predict discovery well. Your **visit notes** and the **neighborhood** do.

**Why ZIP and not census tract?**  
ZIP is good enough for driving-scale decisions. If you want finer resolution later, the math stays the same.

**What if two stores tie?**  
Use JScore (your curation prior) as a tie-breaker, or prefer higher-credibility estimates.

---

## What “credibility” means

Early on, estimates are noisier. Atlas attaches **Cred** (0–1) to each store so you can:
- Prioritize high-cred picks when the day matters,
- Keep an eye on low-cred stores for **exploration**.

---

## Where to learn the math

- V/Y definitions & mapping: `vy-whitepaper.md`  
- Data fields & formulas: `vy-data-dictionary.md`  
- Affluence priors: `rust-belt-atlas-affluence-model.md`

