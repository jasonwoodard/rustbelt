# rustbelt-census — Functional Specification (v0.1)

## 1. Overview

`rustbelt-census` is a small Python CLI that fetches U.S. Census Bureau **ACS 5-year** data at the **ZCTA (ZIP Code Tabulation Area)** level and emits a “SQLite-ready” flat file for ingestion into Atlas’s SQLite database.

The tool’s primary output is a single dataset: **ZCTA affluence signals** used by Atlas for scoring/analysis.

---

## 2. Goals

### 2.1 Primary goals
1. Accept a set of ZIP codes (ZCTA5) and/or a geographic region (state) as input.
2. Fetch the **latest available** ACS 5-year vintage automatically (no user-provided year required).
3. Compute and output Atlas-ready affluence metrics per ZCTA:
   - `MedianIncome`
   - `PctHH_100kPlus`
   - `PctRenters`
   - `Population`
4. Emit output in a format designed for **reliable SQLite ingestion** (default CSV).
5. Emit provenance metadata so results are reproducible/auditable.

### 2.2 Non-goals (v0.1)
- Writing directly to SQLite (ingestion handled by downstream tooling).
- Any normalization or “metro-relative” modeling for Atlas scoring (this tool only fetches + derives).
- Tract-level (or finer) geography support.

---

## 3. Data Source Requirements

### 3.1 Dataset
- Source: U.S. Census Bureau Data API
- Dataset: **ACS 5-year** detailed tables (API dataset path `acs/acs5`)
- Vintage selection: the tool MUST automatically discover and use the latest available vintage.

#### 3.1.1 Latest-vintage discovery
The tool MUST discover the latest available ACS 5-year vintage using the Census API discovery metadata endpoint (`api.census.gov/data.json`), selecting the maximum year that supports `acs/acs5`.

### 3.2 Variables required (estimates)
The tool MUST fetch sufficient ACS variables to compute the required outputs.

Minimum required outputs and their sources:
- Median household income:
  - ACS table B19013 (estimate)
- Population:
  - ACS table B01003 (estimate)
- Renter share:
  - ACS table B25003 (estimate counts used for derivation)
- % households with income > $100k:
  - ACS table B19001 (estimate bins used for derivation)

> Note: ACS variables typically end with suffix `E` (estimate). Margin-of-error variables (`M`) are out-of-scope for v0.1.

---

## 4. Derived Metric Definitions

### 4.1 `PctRenters`
Derived from B25003 occupancy counts:
- numerator: renter-occupied count
- denominator: total occupied housing units (or the appropriate total for the chosen derivation)

Computation:
- `PctRenters = 100 * (renter_count / denominator_count)`
- Must handle denominator = 0 => emit NULL and set `Status = "missing"`.

The tool SHOULD also emit the raw fields used:
- `RentersCount`
- `OccupiedCount` (or `TotalCount`, depending on chosen denominator)

### 4.2 `PctHH_100kPlus`
Derived from B19001 household income distribution:
- numerator: sum of household-count bins whose income range is > $100k
- denominator: total households in B19001 (typically the “total” line)

Computation:
- `PctHH_100kPlus = 100 * (sum_bins_over_100k / total_households)`
- Must handle denominator = 0 => emit NULL and set `Status = "missing"`.

The tool SHOULD also emit:
- `HHCountTotal`
- `HHCount_100kPlus`

### 4.3 Rounding & numeric conventions
- Percent outputs SHOULD be float with configurable precision (default: 3 decimal places).
- Monetary outputs SHOULD be integer (as returned by ACS) unless the API returns float.
- No thousands separators.

---

## 5. CLI Interface

### 5.1 Command structure
Primary subcommand:
- `rustbelt-census affluence`

### 5.2 Input modes (at least one required)
- `--zips 10001,10002,10003`
- `--zips-file path/to/zips.txt` (one ZIP per line; allow blank lines and `# comments`)
- `--state PA` (state postal abbreviation)

Behavior:
- If `--state` is provided with `--zips/--zips-file`, the tool MUST:
  1) fetch the state collection, then
  2) filter to the requested ZIP list (intersection).
- If only `--state` is provided, the tool MUST fetch all ZCTAs for that state (collection pull).

### 5.3 Output flags
- `--out <path>` (default: stdout)
- `--format csv|jsonl` (default: `csv`)
- `--emit-sqlite-ready` (default: ON)
- `--include-audit-fields` (default: ON)

### 5.4 Operational flags
- `--cache-dir <path>` (default: platform-appropriate cache dir)
- `--timeout <seconds>` (default: 20)
- `--retries <n>` (default: 3)
- `--api-key-env <ENV_VAR>` (default: `CENSUS_API_KEY`)

---

## 6. Fetch Strategy

### 6.1 Default strategy (v0.1)
Default MUST be **state collection fetch via `ucgid`** when `--state` is provided.

Rationale:
- Supports “prospecting” workflows (get all ZCTAs in region, then filter/rank).
- `ucgid` supports geographic collections not available via simple wildcard predicates.

### 6.2 Targeted ZIP strategy
If only `--zips/--zips-file` is provided, the tool SHOULD fetch by explicit ZCTA values.
Implementation may choose:
- per-ZIP requests, or
- one broader pull then filter,
as long as behavior is correct and testable.

### 6.3 State to `ucgid` mapping requirement
The tool MUST convert state postal abbreviation (e.g., `PA`) into the appropriate state identifier required to construct the `ucgid` predicate.

If an invalid state is provided:
- exit non-zero
- emit an actionable error message

---

## 7. Output Schema

### 7.1 Required columns (all formats)
One record per ZCTA:
- `zip` (TEXT, 5 characters, leading zeros preserved)
- `name` (TEXT, optional but recommended; Census `NAME`)
- `median_income` (INTEGER or NULL)
- `pct_hh_100k_plus` (REAL or NULL)
- `pct_renters` (REAL or NULL)
- `population` (INTEGER or NULL)

### 7.2 Metadata columns (required)
- `acs_year` (INTEGER) — the vintage year actually used
- `dataset` (TEXT) — fixed value `acs/acs5`
- `fetched_at_utc` (TEXT ISO8601)
- `status` (TEXT) — one of: `ok`, `missing`, `error`
- `error_message` (TEXT, nullable)

### 7.3 Audit columns (default ON)
- `renters_count` (INTEGER)
- `occupied_count` (INTEGER) or chosen denominator count
- `hh_count_100k_plus` (INTEGER)
- `hh_count_total` (INTEGER)

### 7.4 SQLite-ready rules (default ON)
When `--emit-sqlite-ready` is enabled:
- CSV MUST include a header row.
- NULL values MUST be represented as empty fields in CSV.
- zip MUST be emitted as a text field (string) to preserve leading zeros.
- Numeric fields MUST be plain decimal representations without locale formatting.

If `--format jsonl`, each line MUST be a single JSON object with the same field names.

---

## 8. Data Quality & Validation

### 8.1 ZIP validation
- Normalize whitespace.
- Accept only 5-digit ZIPs.
- Preserve input order but de-duplicate.

### 8.2 Error handling
- Partial success is allowed:
  - errors for some ZIPs MUST NOT prevent output for other ZIPs
  - failed ZIPs MUST be included with `status="error"` and `error_message`

### 8.3 Determinism
For the same discovered `AcsYear` and same inputs:
- output ordering MUST be deterministic
- derived fields MUST be deterministic

---

## 9. Caching Requirements
The tool SHOULD cache:
- the discovered latest `AcsYear`
- state collection results (if fetched)
to reduce repeated calls during development/iteration.

Cache must be safe to delete.

---

## 10. Testing Requirements (v0.1)

### 10.1 Unit tests (required)
- ZIP parsing/normalization
- `PctRenters` derivation (including denom=0 handling)
- `PctHH_100kPlus` derivation (including denom=0 handling)
- Output formatting rules (CSV header, NULL handling, Zip-as-text, numeric formatting)

### 10.2 Integration / golden tests (required)
- Run against a small fixed input set (e.g., known ZIPs in one state)
- Assert:
  - output schema matches
  - `AcsYear` is discovered and emitted
  - percent fields are within expected numeric bounds [0, 100]
  - `Status` is `ok` for those ZIPs

---

## 11. CLI User Experience Mini-Guide (v0.1)

This section defines expected “feel” and ergonomics so implementations converge.

### 11.1 Help text and discoverability
- `rustbelt-census --help` MUST show:
  - one-line description
  - list of subcommands
  - how to get subcommand help

- `rustbelt-census affluence --help` MUST show:
  - input modes (`--state`, `--zips`, `--zips-file`)
  - output modes (`--out`, `--format`)
  - operational flags (`--cache-dir`, `--timeout`, `--retries`, `--api-key-env`)
  - defaults for each flag

### 11.2 Defaults and “no drama” operation
- Default output format: CSV to stdout.
- Default: `--emit-sqlite-ready` ON, `--include-audit-fields` ON.
- If the user provides `--out`, the tool writes to that path and prints a short summary to stderr.
- If no input mode is provided, exit non-zero with a clear message and show the relevant help snippet.

### 11.3 Progress and logging conventions
- All **data output** goes to stdout (unless `--out` is used).
- All **logs/progress** go to stderr.
- A typical run SHOULD print to stderr:
  - the discovered `AcsYear`
  - the chosen input mode (state / zip list)
  - number of rows fetched
  - number of rows emitted
  - cache hit/miss summary (brief)

Example stderr summary (illustrative):
- `Using ACS vintage: 2023 (acs/acs5)`
- `Fetching ZCTAs for state=PA (ucgid strategy)`
- `Fetched 1451 rows; emitted 1451 rows; status: ok=1451 missing=0 error=0`

### 11.4 Exit codes (behavioral contract)
- `0`: command succeeded; output emitted (even if some rows are `missing`).
- `2`: invalid usage (bad flags, no input mode, invalid state code, bad zip format).
- `3`: upstream fetch failure that prevents producing any meaningful output (e.g., cannot discover latest year, network failure before any data fetched).

(Exact codes can differ, but MUST be documented and stable.)

### 11.5 Error message style
Errors MUST be:
- specific (what failed)
- actionable (how to fix)
- non-verbose by default (stack traces only under a `--debug` flag if you add one later)

Examples:
- `Invalid ZIP '12A45'. ZIPs must be 5 digits.`
- `Unknown state code 'PX'. Expected a 2-letter USPS code (e.g., PA).`
- `Failed to discover latest ACS vintage from api.census.gov/data.json. Try again or set CENSUS_API_KEY.`

### 11.6 Input file conventions (`--zips-file`)
- Accept:
  - blank lines
  - lines beginning with `#` treated as comments
- Normalize:
  - whitespace trimming
- Reject:
  - non-5-digit ZIPs (usage error)

### 11.7 Output ordering contract
To support reproducible diffs and deterministic ingest:
- If `--state` only: output rows MUST be sorted by `Zip` ascending.
- If `--zips` or `--zips-file` only: output rows MUST follow the user’s input order (after de-dupe).
- If `--state` combined with zip filter: output MUST follow zip input order (intersection), not state order.

---

## 12. Example Workflows

### 12.1 “Prospecting” — fetch all ZCTAs in a state (Eastern PA / Pennsylvania)
Goal: load a whole state’s ZCTA affluence so Atlas can rank and you can identify new areas.

```bash
# Write PA affluence dataset to a CSV artifact
rustbelt-census affluence --state PA --out pa_zcta_affluence.csv
```

Typical next step (outside this tool):
- import the CSV into SQLite
- run queries like “top N median income” or “top N %HH > 100k”, filtered by population thresholds

### 12.2 “Targeted refresh” — fetch a small list of ZIPs (new stores discovered)
Goal: you visited 2 new ZIPs; fetch only those.

```bash
rustbelt-census affluence --zips 19103,19104 --out new_zips.csv
```

Expected behavior:
- output contains exactly those ZIP rows (plus metadata/audit/status fields)

### 12.3 ZIP list from file (field workflow)
Goal: keep a rolling list of “uncovered” ZIPs and fetch them in one go.

`zips.txt`:
```text
# Philly area
19103
19104

# Pittsburgh
15206
```

Run:
```bash
rustbelt-census affluence --zips-file zips.txt --out zcta_patch.csv
```

### 12.4 Filtered state pull (state + zip list intersection)
Goal: you want the state collection behavior (one fetch), but only emit the subset you care about.

```bash
rustbelt-census affluence --state PA --zips-file zips.txt --out zcta_subset.csv
```

Expected behavior:
- the tool fetches the PA collection
- output contains only ZIPs present in `zips.txt` that are valid ZCTAs within PA
- if a ZIP is not present in PA’s ZCTA set, emit that ZIP as `Status="missing"` (and keep the row), OR omit it.
  - v0.1 MUST choose one behavior and document it; recommended default:
    - keep the row with `Status="missing"` (helps you track why it didn’t appear)

### 12.5 JSONL output (optional portability)
Goal: you want line-delimited JSON to pipe into another system or for easier programmatic diffing.

```bash
rustbelt-census affluence --state PA --format jsonl --out pa_zcta_affluence.jsonl
```

### 12.6 Pipe to another tool via stdout
Goal: compose with other CLI tooling.

```bash
rustbelt-census affluence --state PA > pa_zcta_affluence.csv
```

Expected behavior:
- stdout is *only* the CSV
- progress/logs go to stderr

---

## 13. Out of Scope / Future Enhancements
- `--include-moe` support (MOE variables) and uncertainty propagation
- tract-level geography support and address→tract mapping
- direct SQLite write mode (optional future convenience)
