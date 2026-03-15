# Rustbelt Pipeline

The Makefile at the repository root connects the three components —
storedb → Atlas → Solver — into a single command sequence.

---

## Prerequisites

| Component | Setup |
|-----------|-------|
| `rustbelt-atlas` | `cd packages/atlas-python && pip install -e .` |
| `rustbelt` | `cd packages/solver-cli && npm install && npm run build` |
| `storedb/rustbelt.db` | SQLite database populated with stores, batches, and observations |

---

## Targets

### `make score BATCH=<name>`

Exports stores, affluence, and observations from storedb for the named batch,
then runs Atlas blended scoring.

```bash
make score BATCH=Florida-Set
```

**Output** (written to `out/Florida-Set/`):

| File | Contents |
|------|----------|
| `stores.csv` | Store attributes for Atlas |
| `affluence.csv` | ZIP-level affluence covariates |
| `observations.csv` | Visit observations for posterior scoring |
| `scored-stores.csv` | Per-store Value, Yield, and Composite scores |
| `trace.jsonl` | Scoring trace for explainability |

**Overridable defaults:**

```bash
make score BATCH=Florida-Set LAMBDA=0.7 OMEGA=0.6 MODE=prior-only
```

| Variable | Default | Description |
|----------|---------|-------------|
| `LAMBDA` | `0.6` | λ weight: `λ·Value + (1-λ)·Yield` |
| `OMEGA` | `0.5` | ω weight blending prior and posterior |
| `MODE` | `blended` | Atlas scoring mode |
| `DB` | `storedb/rustbelt.db` | SQLite database path |

---

### `make inject BATCH=<name> TRIP=<path>`

Merges Atlas `Composite` scores into a trip JSON file.

```bash
make inject BATCH=Florida-Set TRIP=trips/florida-2026.json
```

Writes `trips/florida-2026-scored.json`. Unmatched stores (stores in the trip
not present in `scored-stores.csv`) are logged and left without a score; the
solver falls back to count-only objective for those stops.

You can also call the script directly:

```bash
python3 scripts/inject_scores.py \
    --scores out/Florida-Set/scored-stores.csv \
    --trip   trips/florida-2026.json \
    --out    trips/florida-2026-scored.json
```

---

### `make plan BATCH=<name> TRIP=<path> DAY=<id>`

Full pipeline in one command: `score → inject → solve`.

```bash
make plan BATCH=Florida-Set TRIP=trips/florida-2026.json DAY=2026-03-15
```

Prints the itinerary JSON to stdout. Pass solver flags after the target if
needed, or run `rustbelt solve-day` directly on the scored trip file.

---

### `make help`

Lists all targets and overridable defaults.

---

## Typical workflow

```bash
# 1. Score the batch
make score BATCH=Florida-Set

# 2. Check the scores
head -5 out/Florida-Set/scored-stores.csv

# 3. Inject into the trip file
make inject BATCH=Florida-Set TRIP=trips/florida-2026.json

# 4. Solve a day (HTML output)
rustbelt solve-day \
    --trip trips/florida-2026-scored.json \
    --day  2026-03-15 \
    --lambda 0.6 \
    --html out/day1.html

# 5. Mid-trip reoptimization (unchanged — already worked before the pipeline)
rustbelt solve-day \
    --trip trips/florida-2026-scored.json \
    --day  2026-03-15 \
    --now  13:30 --at 27.94,-82.46 \
    --done store-id-1,store-id-2
```

---

## Store type mapping

Atlas is intentionally rigid: it recognises exactly five store types
(`Thrift`, `Antique`, `Vintage`, `Flea/Surplus`, `Unknown`) and carries no
knowledge of storedb's operational classifications. The storedb export view
is responsible for translating DB types to Atlas-canonical types before
they leave the database.

The mapping lives in `storedb/build-run-views.sql` inside `v_store_score_out`:

| storedb `store_type` | Exported `Type` |
|----------------------|----------------|
| `Thrift` | `Thrift` |
| `Antique` | `Antique` |
| `Vintage` | `Vintage` |
| `Flea/Surplus` | `Flea/Surplus` |
| `Flea` | `Flea/Surplus` |
| `Surplus` | `Flea/Surplus` |
| `Junk` | `Thrift` |
| anything else | `Unknown` |

If a type slips through the export unresolved, Atlas logs a warning to stderr
and scores the store with the `Unknown` baseline:

```
[atlas] warning: unrecognized store type 'Nautical' — scored with 'Unknown' baseline.
        Check the storedb export view (build-run-views.sql).
```

To add a new type: update the `CASE` in `build-run-views.sql` and re-run
`sqlite3 rustbelt.db < storedb/build-run-views.sql` to refresh the view.

---

## Output directory

`out/` is gitignored. Each batch run lands in `out/<BATCH>/` and can be
regenerated at any time from the database.

---

## See also

- [Atlas CLI reference](atlas/rust-belt-atlas-cli-reference.md)
- [Solver CLI reference](solver/rust-belt-cli-documentation.md)
- [Trip schema guide](solver/trip-schema-guide.md)
