# `rustbelt-discover` — Functional Specification

**Status:** Draft v0.1  
**Scope:** Store location discovery via Google Places API → storedb ingestion  
**Related:** `rustbelt-census` (ZIP geo data), `storedb/schema.sql`, `make score`

---

## 1. Overview

`rustbelt-discover` is a Python CLI that queries the Google Places API (New) for
thrift, antique, vintage, flea, and consignment stores within a geographic search
area, then ingests discovered stores into the storedb SQLite database.

It replaces manual store lookup and entry as the primary method of building up
the store corpus before a trip. A typical invocation discovers 30–60 stores for
a new metro area, populates `stores`, `store_hours`, and `store_google`, and
emits a ZIP list for a follow-up `rustbelt-census` run.

---

## 2. Goals

1. Accept a geographic search area (center point + radius) and run targeted
   Nearby Search queries across all configured store-type search terms.
2. Fetch Place Details for each unique result using a minimal field mask
   (Essentials + hours only — no ratings, no reviews).
3. Deduplicate results across search terms by Google Place ID before any DB writes.
4. Ingest new stores into `stores`, `store_hours`, and `store_google`.
5. For stores already in the DB: update `store_hours` and `store_google` metadata;
   leave all core record fields (`store_name`, `address`, `jscore_prior`,
   `store_note`, etc.) untouched.
6. Emit a summary report to stdout after every run.
7. Emit a `new-zips.txt` file listing ZIP codes of newly inserted stores, ready
   for a follow-up `rustbelt-census` run.
8. Support `--dry-run` mode that executes all API calls and prints the full
   would-be report but performs no DB writes.

### Non-goals (v0.1)

- Direct invocation of `rustbelt-census` inline (ZIP list file is the handoff).
- Geocoding a city name to a center point (caller must supply lat/lon).
- Fetching ratings, review counts, or any Atmosphere-tier data.
- Importing stores from sources other than Google Places API.
- Batch/trip-scoped discovery (discovery is always geographic, not trip-aware).

---

## 3. CLI Interface

```
rustbelt-discover [OPTIONS]
```

### Required flags

| Flag | Type | Description |
|------|------|-------------|
| `--lat` | float | Latitude of search center |
| `--lon` | float | Longitude of search center |
| `--radius` | float | Search radius in miles |

### Optional flags

| Flag | Default | Description |
|------|---------|-------------|
| `--db` | `storedb/rustbelt.db` | Path to SQLite database |
| `--api-key-env` | `GOOGLE_PLACES_API_KEY` | Env var containing the API key |
| `--types` | all | Comma-separated subset of store types to search (see §4.1) |
| `--dry-run` | false | Run all API calls; print report; do not write to DB |
| `--zips-out` | `discover-zips.txt` | Path for new-ZIP output file (use `-` for stdout) |
| `--report-out` | stdout | Path for summary report (default: stdout) |
| `--timeout` | 20 | HTTP timeout in seconds |
| `--retries` | 3 | HTTP retry count on transient failures |

### Example invocations

```bash
# Venice, FL — 30-mile radius, dry run first
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30 --dry-run

# Commit to DB
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30

# Antique and vintage only
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30 --types antique,vintage

# Follow up with census data
rustbelt-census affluence --zips-file discover-zips.txt --out venice-zcta.csv
```

---

## 4. Search Strategy

### 4.1 Store type search terms

The tool issues one Nearby Search request per search term (with pagination up to
3 pages / 60 results per term). Search terms map to storedb `store_type` values
as follows:

| Type key | Google search text | storedb `store_type` |
|----------|--------------------|----------------------|
| `thrift` | `"thrift store"` | `Thrift` |
| `antique` | `"antique store"` | `Antique` |
| `antique` | `"antique mall"` | `Antique` |
| `vintage` | `"vintage store"` | `Vintage` |
| `vintage` | `"consignment shop"` | `Vintage` |
| `flea` | `"flea market"` | `Flea` |
| `surplus` | `"surplus store"` | `Surplus` |

All types are searched by default. The `--types` flag accepts a comma-separated
list of type keys (e.g., `--types thrift,antique`) to restrict the search.

### 4.2 Deduplication

Google Place ID is the deduplication key. After all Nearby Search pages are
collected across all search terms, results are deduplicated by `place_id` before
any Place Details calls are made. One store appearing under multiple search terms
(e.g., a store tagged as both "thrift" and "vintage") triggers exactly one Place
Details call and is assigned the `store_type` of the first matching search term
in the order shown in §4.1.

### 4.3 Radius handling

Google Places Nearby Search (New) accepts radius in meters with a maximum of
50,000m (~31 miles). The `--radius` flag accepts miles; the tool converts to
meters internally. If the requested radius exceeds 50,000m, the tool exits with
a usage error:

```
Error: --radius 35 exceeds the Google Places API maximum of ~31 miles (50,000m).
```

---

## 5. Google Places API Integration

### 5.1 API version

Use the **Places API (New)** endpoints exclusively. Do not use legacy Places API
endpoints.

- Nearby Search: `POST https://places.googleapis.com/v1/places:searchNearby`
- Place Details: `GET https://places.googleapis.com/v1/places/{place_id}`

### 5.2 Field mask

All requests use an explicit field mask to minimise SKU tier and cost.

**Nearby Search field mask** (Essentials only — used to collect place IDs):
```
places.id,places.displayName,places.primaryType
```

**Place Details field mask** (Essentials + Pro for hours):
```
id,displayName,formattedAddress,location,regularOpeningHours,googleMapsUri,types,primaryType
```

Including `regularOpeningHours` triggers the **Pro SKU** (~$0.003/call).
Ratings (`rating`, `userRatingCount`) are deliberately excluded — they are
Atmosphere-tier and not used by RustBelt's scoring model.

### 5.3 Pagination

Nearby Search returns up to 20 results per page. Retrieve up to 3 pages (60
results) per search term using the `pageToken` field. Stop early if a page
returns fewer than 20 results (no more pages available).

### 5.4 Rate limiting and retries

- Add a 0.1-second delay between consecutive API calls to avoid hitting per-second
  quotas.
- On HTTP 429 or 503, retry with exponential backoff (base 1s, max 3 retries).
- On HTTP 400 (bad request) or 404 (place not found), log a warning and skip that
  place — do not retry.

---

## 6. Store Type Assignment

The `store_type` assigned to a discovered store is determined by the first search
term (in §4.1 order) that returned that Place ID. This is a best-effort
classification. The storedb taxonomy is intentionally broad; manual correction of
`store_type` after import is expected and supported.

The Google Places `types` array is stored for reference in a future enrichment
pass but is not used to drive classification in v0.1.

---

## 7. `store_id` Assignment

`store_id` is a short human-readable identifier (e.g., `AAPTS`, `PG`) used in
trip files and spreadsheet workflows. It originated as a workaround when the DB
lacked a surrogate key; the schema now has `store_pk INTEGER PRIMARY KEY
AUTOINCREMENT` which handles all internal FK relationships.

**Discovered stores are inserted with `store_id = NULL`.** No slug generation
is performed at import time. `store_id` remains a manually assigned field for
stores that have been curated and need a memorable, stable handle for use in
handwritten trip JSON or other contexts where the numeric PK is unwieldy.

The existing export view handles NULL `store_id` gracefully via a fallback:

```sql
-- v_store_score_out (storedb/build-run-views.sql)
COALESCE(NULLIF(store_id, ''), printf('S%06d', store_pk)) AS StoreId
```

**Planned migration (out of scope for v0.1):** The Solver trip JSON currently
uses `store_id` (the short text code) as the stop identifier. This was a
bootstrap approach predating the surrogate PK. The intended end state is for
trip JSON to reference `store_pk` directly, removing the dependency on
`store_id` being assigned at all. When that migration lands, the `S%06d`
fallback in the export view becomes unnecessary and `store_id` becomes a
display/annotation convenience only.

Until that migration is complete, discovered stores will appear as `S%06d`
identifiers in trip files — functional but not human-friendly. Assign a short
`store_id` manually for any store you expect to reference repeatedly in
handwritten trip JSON before the migration lands.

---

## 8. Database Write Behavior

### 8.1 Default behavior (no `--dry-run`)

The tool writes to three tables within a single transaction per store. If any
write fails for a store, that store's transaction is rolled back and the failure
is recorded in the report; other stores are unaffected.

#### `stores` table

```sql
INSERT INTO stores (
  store_id, store_name, store_type,
  address, city, state, zip,
  lat, lon, google_url, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT(store_name, address) DO UPDATE SET
  -- Update only non-curated fields; leave jscore_prior, store_note untouched
  google_url = excluded.google_url,
  updated_at = datetime('now')
```

The unique conflict key is `(store_name, address)` per the existing schema index
`stores_name_addr_uq`. On conflict (store already exists), only `google_url` and
`updated_at` are updated; `store_type`, `lat`, `lon`, and all other curated
fields are left untouched.

#### `store_google` table

> **Schema note:** Despite its name, `store_google.store_id` is an `INTEGER`
> column and a foreign key to `stores.store_pk` — not the text `store_id` field.
> The implementer must bind the `store_pk` integer value here, not the short
> text code.

```sql
-- store_google.store_id = stores.store_pk (INTEGER FK, despite the column name)
INSERT INTO store_google (store_id, google_url, google_cid, last_seen_at)
VALUES (?, ?, ?, datetime('now'))  -- bind store_pk for the first ?
ON CONFLICT(store_id) DO UPDATE SET
  google_url   = excluded.google_url,
  google_cid   = COALESCE(excluded.google_cid, store_google.google_cid),
  last_seen_at = datetime('now')
```

`google_cid` is parsed from `googleMapsUri` if the URL contains a `cid=`
parameter. If not parseable, leave `NULL` (do not overwrite an existing CID).

#### `store_hours` table

Hours from `regularOpeningHours` are always written (upserted) for discovered
stores, including for stores that already existed in the DB. This allows a
re-discovery run to refresh stale hours.

```sql
INSERT INTO store_hours (store_id, day_of_week, open_min, close_min)
VALUES (?, ?, ?, ?)
ON CONFLICT(store_id, day_of_week) DO UPDATE SET
  open_min  = excluded.open_min,
  close_min = excluded.close_min
```

### 8.2 Hours mapping: Google → storedb

Google's `regularOpeningHours.periods` uses Sunday=0 through Saturday=6.
storedb uses Monday=0 through Sunday=6. The tool must remap:

| Google `day` | storedb `day_of_week` |
|---|---|
| 0 (Sunday) | 6 |
| 1 (Monday) | 0 |
| 2 (Tuesday) | 1 |
| 3 (Wednesday) | 2 |
| 4 (Thursday) | 3 |
| 5 (Friday) | 4 |
| 6 (Saturday) | 5 |

Times from `open.hour` / `open.minute` are converted to integer minutes since
midnight: `open_min = hour * 60 + minute`.

If `regularOpeningHours` is absent in the Place Details response, no `store_hours`
rows are written (the store is still inserted; hours remain NULL).

If a day has no `periods` entry (closed that day), insert a row with
`open_min = NULL, close_min = NULL` (per the existing schema convention where
NULL means closed).

Only the **first period** per day is written. Multi-window hours (split days) are
not supported by the storedb schema; if a day has multiple periods, use the first
and log a warning:
```
[warn] store 'Venice Antique Mall': Thursday has 2 open windows; using first only.
```

### 8.3 `--dry-run` mode

All API calls are executed normally. No DB connections are opened. The full
report is printed to stdout. The `new-zips.txt` file is **not** written in dry-run
mode.

---

## 9. Output

### 9.1 Summary report (stdout)

Printed after every run (dry-run or live):

```
rustbelt-discover — Venice, FL area (27.0998, -82.4543) r=30mi
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Search terms:    7
Raw results:     84  (after pagination)
Unique places:   51  (after deduplication by Place ID)
Details fetched: 51

  Inserted (new):  38
  Updated (exist): 11
  Skipped (error):  2

By type:
  Thrift:   14
  Antique:  19
  Vintage:   9
  Flea:      5
  Surplus:   2

Hours coverage:  47 / 51  (92%)

New ZIPs (for rustbelt-census):  6
  34285, 34292, 34293, 34228, 34229, 34231

Errors:
  [skip] 'ChIJxxx': Place Details returned 404 — not found
  [skip] 'ChIJyyy': No address in response — cannot determine ZIP

API calls:  51 Nearby Search + 51 Place Details = 102 total
Estimated cost: ~$0.00  (within free tier)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DRY RUN — no database writes performed
```

(The "DRY RUN" footer line is omitted on live runs.)

### 9.2 New-ZIP file (`discover-zips.txt`)

Written only on live runs (not dry-run). Contains one ZIP per line, sorted
ascending, with a header comment:

```text
# rustbelt-discover new ZIPs — 2026-03-20T14:32:00Z
# Venice, FL area (27.0998, -82.4543) r=30mi
# Feed to: rustbelt-census affluence --zips-file discover-zips.txt --out venice-zcta.csv
34228
34229
34231
34285
34292
34293
```

Only ZIPs from **newly inserted** stores are included. ZIPs from updated
(already-existing) stores are omitted on the assumption that `zip_detail` already
has coverage.

---

## 10. Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing required flag (`--lat`, `--lon`, `--radius`) | Usage error, exit code 2 |
| `--radius` > 31 miles | Usage error, exit code 2 |
| `GOOGLE_PLACES_API_KEY` env var not set | Error message, exit code 1 |
| API key invalid (HTTP 401/403) | Error message, exit code 1 |
| Transient API failure after retries | Log warning; skip affected places; continue |
| Place Details returns no address | Log warning; skip store; record in report |
| DB write failure for a store | Log warning; rollback that store's transaction; continue |
| All places fail | Exit code 1 after printing report |

Exit codes:
- `0` — success (at least one store inserted or updated)
- `1` — runtime failure (API auth, all places failed, DB unwritable)
- `2` — usage error (bad flags, radius too large)

---

## 11. Integration with Existing Pipeline

`rustbelt-discover` is a **pre-pipeline** tool. It populates storedb before the
`make score` pipeline runs. The expected workflow for a new trip area is:

```bash
# 1. Discover stores
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30

# 2. Fetch census data for discovered ZIPs
rustbelt-census affluence --zips-file discover-zips.txt --out venice-zcta.csv

# 3. Import census data
sqlite3 storedb/rustbelt.db < storedb/import-zip-data.sql

# 4. Score and plan as normal
make score BATCH=Venice-Set
```

No changes to `make score`, Atlas, or the Solver are required.

---

## 12. Package Layout

Following the existing monorepo convention:

```
packages/
  rustbelt-discover/
    src/
      discover/
        __init__.py
        cli.py          # argparse entry point
        places.py       # Google Places API client
        ingest.py       # DB write logic
        types.py        # search term config, store type mapping
        hours.py        # Google hours → storedb conversion
        report.py       # summary report formatting
    tests/
      test_places.py
      test_ingest.py
      test_hours.py
    pyproject.toml
    README.md
```

Entry point: `rustbelt-discover` (registered via `pyproject.toml` console_scripts).

---

## 13. Open Questions / Post-v0.1

- **Makefile target:** Add `make discover LAT=... LON=... RADIUS=...` to the
  root Makefile for consistency with `make score` and `make plan`.
- **Tract-level geo enrichment:** `rustbelt-discover` outputs ZIPs; a future
  `rustbelt-discover` v0.2 or separate tool could additionally emit tract GEOIDs
  for catchment area modeling (see Spec 3).
- **`--types` default customization:** Consider a config file or env var to
  persist a preferred default type set rather than always requiring `--types`.
- **Re-discovery / refresh workflow:** Running discovery on an area already in
  the DB currently updates hours and google metadata only. A `--refresh-hours`
  flag could explicitly target an existing batch of stores for a hours-only
  refresh pass without inserting new stores.

---

## 14. Architectural Decision: `store_pk` as Canonical Store Identifier

**Decision (recorded here for implementation awareness):**

The short `store_id` text code (e.g., `AAPTS`, `PG`) was a bootstrap convention
from a pre-DB spreadsheet era. Going forward, `store_pk` (the integer surrogate
key) is the canonical store identifier across the full pipeline — trip JSON stop
IDs, Atlas score files, Solver input, and all pipeline glue scripts.

**Implications for this spec:** `rustbelt-discover` correctly inserts with
`store_id = NULL` and relies on `store_pk`. No further action needed here.

**Implications for the broader pipeline (out of scope for this spec, tracked
here to avoid re-litigating):**

| Component | Current behavior | Target behavior |
|-----------|-----------------|-----------------|
| Trip JSON `stores[].id` | `store_id` short code | `store_pk` as string (e.g. `"42"`) |
| `v_store_score_out` | `COALESCE(store_id, printf('S%06d', store_pk))` | `CAST(store_pk AS TEXT)` directly |
| `inject_scores.py` | matches on `StoreId` from export view | unchanged — follows the view |
| `store_id` column | still exists; manually assigned for curated stores | retained as a human label, not a system key |

The `v_store_score_out` COALESCE is already a valid bridge and can remain until
the trip JSON convention is formally migrated. The migration is a single-pass
find-and-replace across existing trip JSON files plus a minor update to the
export view — low risk, do when convenient.

---

## 14. Architectural Decision: `store_pk` as Canonical Store Identifier

**Decision (recorded here for implementation awareness):**

The short `store_id` text code (e.g., `AAPTS`, `PG`) was a bootstrap convention
from a pre-DB spreadsheet era. Going forward, `store_pk` (the integer surrogate
key) is the canonical store identifier across the full pipeline — trip JSON stop
IDs, Atlas score files, Solver input, and all pipeline glue scripts.

**Implications for this spec:** `rustbelt-discover` correctly inserts with
`store_id = NULL` and relies on `store_pk`. No further action needed here.

**Implications for the broader pipeline (out of scope for this spec, tracked
here to avoid re-litigating):**

| Component | Current behavior | Target behavior |
|-----------|-----------------|-----------------|
| Trip JSON `stores[].id` | `store_id` short code | `store_pk` as string (e.g. `"42"`) |
| `v_store_score_out` | `COALESCE(store_id, printf('S%06d', store_pk))` | `CAST(store_pk AS TEXT)` directly |
| `inject_scores.py` | matches on `StoreId` from export view | unchanged — follows the view |
| `store_id` column | still exists; manually assigned for curated stores | retained as a human label, not a system key |

The `v_store_score_out` COALESCE is already a valid bridge and can remain until
the trip JSON convention is formally migrated. The migration is a single-pass
find-and-replace across existing trip JSON files plus a minor update to the
export view — low risk, do when convenient.
