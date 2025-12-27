# rustbelt-census — Technical Plan (v0.1)

## Goal / Scope
Build a Python CLI subcommand `rustbelt-census affluence` that:
- discovers the latest ACS 5-year vintage automatically,
- fetches the ACS variables needed for affluence metrics,
- derives metrics per the rules in `rb-census-functional-spec.md`, and
- outputs SQLite-ready CSV or JSONL.

This plan targets the v0.1 functional requirements and intentionally avoids direct SQLite writes or tract-level geography.

## Tech choices (Python)
### CLI: `argparse` vs `typer`
- **`argparse` (standard library)**
  - ✅ No extra dependency; predictable behavior in minimal environments.
  - ✅ Easy to document defaults and usage patterns.
  - ❌ More verbose for subcommand and option wiring.
- **`typer` (Click-based)**
  - ✅ Cleaner ergonomics for subcommands and shared options.
  - ✅ Type hints map to CLI parsing and help output.
  - ❌ Adds dependency weight; Click tends to expand transitive deps.

**Recommendation:** default to `argparse` for simplicity and zero-dep CLI; reconsider `typer` only if CLI ergonomics become too costly to maintain.

### HTTP: `httpx` vs `requests`
- **`requests`**
  - ✅ Ubiquitous, stable, simplest synchronous usage.
  - ❌ No built-in async path (not needed for v0.1).
- **`httpx`**
  - ✅ Modern API; optional async if future batching is needed.
  - ❌ Slightly heavier dependency and surface area.

**Recommendation:** use `requests` for v0.1 simplicity unless async/batching is introduced.

### Data shaping
Use only Python standard library (`csv`, `json`, `datetime`, `decimal`, `typing`) to keep the tool lightweight and avoid heavy dependencies.

### Caching
Use `platformdirs` to locate an OS-appropriate cache directory; store JSON blobs on disk. Cache entries are keyed by request intent (latest year or state collection) and can be deleted safely.

## Proposed package layout
```
rustbelt_census/
  __init__.py
  cli.py           # argument parsing + subcommand dispatch
  census_api.py    # API discovery + query construction
  derive.py        # PctRenters, PctHH_100kPlus calc + null handling
  formatters.py    # CSV/JSONL output rules, SQLite-ready rules
  cache.py         # cache read/write
  state_map.py     # postal → state FIPS or ucgid mapping
  tests/           # unit tests per spec
```

## Data flow (step-by-step)
1. **Inputs**: parse `--state`, `--zips`, `--zips-file`, output options, and operational flags.
2. **Normalize ZIPs**: trim whitespace, drop blanks/comments, validate 5-digit ZIPs, de-dupe while preserving order.
3. **Discover latest ACS5**: hit `api.census.gov/data.json`, select max year with dataset `acs/acs5` (cache this).
4. **Resolve state → `ucgid`**: map USPS postal abbreviation to `ucgid`/FIPS mapping (fail fast on invalid state).
5. **Fetch raw variables**: construct `get=` list for B19013, B01003, B25003, B19001 tables; use state `ucgid` or ZIP filter strategy per spec.
6. **Derive metrics**: compute `PctRenters` and `PctHH_100kPlus`, handling denominator=0 by emitting NULL and `Status="missing"`.
7. **Format output**: build row dicts with required output fields + audit fields, conform to SQLite-ready rules.
8. **Write**: emit to stdout or `--out` path as CSV or JSONL, with deterministic ordering rules from the spec.

## Caching plan
- **Cache keys**
  - `latest_acs5_year.json` → stores `{ "year": 2023, "dataset": "acs/acs5", "fetched_at": "..." }`.
  - `state_collection_{year}_{state}.json` → stores the full response (or parsed rows) for a state-level `ucgid` query.
- **Invalidation**
  - Time-based TTL (e.g., 7–30 days) for latest year discovery.
  - Manual delete of cache directory always safe.
  - Optional CLI flag `--refresh-cache` to bypass cached entries.

## Error handling
- **Invalid state**: exit non-zero (usage error) with a clear error message.
- **Partial failures**: allow rows with `Status="error"` or `Status="missing"` while still emitting valid rows for others.
- **Upstream failures**: if latest-year discovery or full fetch fails before any rows can be produced, exit non-zero and include actionable error text.
- **Status/ErrorMessage behavior**
  - `ok`: all required fields present and derived values computed.
  - `missing`: denom=0 or data missing for a ZIP; emit NULLs, include explanatory `ErrorMessage`.
  - `error`: fetch or parsing errors per ZIP; include `ErrorMessage` and emit row to keep output shape stable.

## Output schema (per `rb-census-functional-spec.md`)
Required fields for each row:
- `Zip`
- `Name`
- `MedianIncome`
- `PctHH_100kPlus`
- `PctRenters`
- `Population`
- `AcsYear`
- `Dataset`
- `FetchedAtUtc`
- `Status`
- `ErrorMessage`

Audit fields (default on):
- `RentersCount`
- `OccupiedCount` (or chosen denominator)
- `HHCount_100kPlus`
- `HHCountTotal`

SQLite-ready formatting rules:
- CSV includes header row.
- NULL values emitted as empty fields in CSV.
- `Zip` emitted as text to preserve leading zeros.
- Numeric fields use plain decimal representation.

## Schema reconciliation plan (storedb)
StoreDB’s `zip_detail` table has now been reviewed. The table should be expanded to accept all fields emitted by `rustbelt-census` so we can preserve provenance and audit values while keeping legacy enrichment columns. With that change, the output schema aligns with the database column names and **no mapping layer is required** for v0.1.

Reconciled column set (DDL excerpt):
```sql
CREATE TABLE IF NOT EXISTS zip_detail (
  zip            TEXT PRIMARY KEY,
  geoid          TEXT,
  city           TEXT,
  state          TEXT,
  county_fips    TEXT,
  name           TEXT,
  population     INTEGER,
  median_income  INTEGER,
  pct_100k_plus  REAL,
  pct_renter     REAL,
  renters_pop    INTEGER,
  pct_ba_plus    REAL,
  lat            REAL,
  lon            REAL,
  acs_year       INTEGER,
  dataset        TEXT,
  fetched_at_utc TEXT,
  status         TEXT,
  error_message  TEXT,
  renters_count  INTEGER,
  occupied_count INTEGER,
  hh_count_100k_plus INTEGER,
  hh_count_total INTEGER
);
```

Reconciliation steps (updated):
1. Keep `rustbelt-census` output field names aligned with `zip_detail` (e.g., `Zip` → `zip`, `Name` → `name` in import logic).
2. Add import-time mapping if needed (CSV header normalization), but avoid renaming in the CLI output.
3. Add a regression test to validate CSV headers match the expected database columns.
