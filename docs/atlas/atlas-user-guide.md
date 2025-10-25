# docs/atlas/USER-GUIDE.md

# Atlas – User Guide (Plain Language)

Atlas helps you decide **where the good stores probably are** and **how to prioritize them** before you ever route the day.

- **Value (V):** how good the “haul” felt (1–5).
- **Yield (Y):** how fast you found buy-worthy items, adjusted for time (1–5).

> Looking for the newest CLI and artifact updates? Read the [Atlas v0.2 release notes](releases/v0.2.md).

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

## Quickstart: run Atlas v0.1 with sample data

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
   - `out/*.csv`: Value/Yield (and optional Composite) per store.
   - `out/*.json` or `out/*.parquet`: Trace files you can attach to QA reports or demos.
   - Re-run with `--explain` for a lightweight sample trace (`atlas-trace.json` / `atlas-trace.csv`).

Re-run the commands with the `sparse_rural` fixtures to see how the engine behaves with minimal observations and heavier reliance on priors.

### Trace output switches

- `--trace-out PATH` writes a combined trace for whichever scoring stages ran. Priors, posteriors, and blend rows are included by default.
- Toggle specific stages with `--no-include-prior-trace`, `--no-include-posterior-trace`, or `--no-include-blend-trace` when you only need a subset (for example, blend-only QA dumps).
- Choose the combined trace format with `--trace-format {jsonl,csv}`. The flag controls the serializer regardless of filename suffix.
- `--posterior-trace PATH` emits posterior-only diagnostics, and `--posterior-trace-format {jsonl,csv}` controls that file separately (default CSV). Posterior rows are still included in the combined trace unless you disable them with `--no-include-posterior-trace`.

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

