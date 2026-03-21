# rustbelt-discover

CLI tool that queries the Google Places API for thrift, antique, vintage, flea,
and consignment stores near a geographic center point, then ingests discovered
stores into the storedb SQLite database.

## Install

```bash
pip install -e packages/rustbelt-discover[dev]
```

## Usage

```bash
# Dry run (API calls only, no DB writes)
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30 --dry-run

# Live run
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30

# Antique and vintage only
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30 --types antique,vintage
```

Set `GOOGLE_PLACES_API_KEY` in the environment before running.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--lat` | required | Latitude of search center |
| `--lon` | required | Longitude of search center |
| `--radius` | required | Search radius in miles (max ~31) |
| `--db` | `storedb/rustbelt.db` | Path to SQLite database |
| `--api-key-env` | `GOOGLE_PLACES_API_KEY` | Env var with API key |
| `--types` | all | Comma-separated store type keys |
| `--dry-run` | false | API calls only; no DB writes |
| `--zips-out` | `discover-zips.txt` | New-ZIP output file (`-` for stdout) |
| `--report-out` | stdout | Summary report output path |
| `--timeout` | 20 | HTTP timeout in seconds |
| `--retries` | 3 | HTTP retry count on transient failures |

## Store types

`thrift`, `antique`, `vintage`, `flea`, `surplus`

## Pipeline integration

```bash
rustbelt-discover --lat 27.0998 --lon -82.4543 --radius 30
rustbelt-census affluence --zips-file discover-zips.txt --out venice-zcta.csv
sqlite3 storedb/rustbelt.db < storedb/import-zip-data.sql
make score BATCH=Venice-Set
```

## Tests

```bash
pytest packages/rustbelt-discover
```
