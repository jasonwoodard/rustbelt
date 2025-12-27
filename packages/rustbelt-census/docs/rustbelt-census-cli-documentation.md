# Rustbelt Census CLI

This document describes how to use the `rustbelt-census` command-line interface. The CLI fetches ACS 5-year ZCTA affluence metrics and emits SQLite-ready output for downstream ingestion.

## Quick Start

Fetch a couple of ZIP codes and print CSV to stdout:

```sh
rustbelt-census affluence --zips 19103,19104
```

Fetch all ZCTAs for a state and write to a file:

```sh
rustbelt-census affluence --state PA --out pa_zcta_affluence.csv
```

## Setup

Install dependencies and run the CLI from the package directory:

```sh
cd packages/rustbelt-census
pip install -e .
rustbelt-census --help
```

## Usage

```
rustbelt-census affluence [--zips <zip,zip>] [--zips-file <path>] [--state <code>] [options]
```

At least one input mode is required: `--zips`, `--zips-file`, or `--state`. When `--state` is combined with a ZIP list, the tool fetches the state collection and filters to the ZIP list (emitting `missing` rows for ZIPs not found in the state dataset).

## Options

| Flag | Description |
| --- | --- |
| `--zips` | Comma-separated list of ZIP codes |
| `--zips-file` | Path to a ZIP list file (one ZIP per line, `#` comments allowed) |
| `--state` | Two-letter USPS state code |
| `--out` | Write output to a file path (default: stdout) |
| `--format` | Output format: `csv` or `jsonl` (default: `csv`) |
| `--emit-sqlite-ready` / `--no-emit-sqlite-ready` | Emit SQLite-ready CSV formatting (default: true) |
| `--include-audit-fields` / `--no-include-audit-fields` | Include audit fields like raw counts (default: true) |
| `--cache-dir` | Cache directory path (default: platform cache dir) |
| `--timeout` | HTTP timeout in seconds (default: 20) |
| `--retries` | HTTP retry count (default: 3) |
| `--api-key-env` | Environment variable containing Census API key (default: `CENSUS_API_KEY`) |
| `--precision` | Percent precision for derived fields (default: 3) |

## Input modes

### ZIP list

Provide a comma-separated list of ZIPs:

```sh
rustbelt-census affluence --zips 19103,19104
```

ZIPs must be 5 digits. Inputs are de-duplicated while preserving order.

### ZIP file

Provide a file with one ZIP per line. Blank lines and `#` comments are ignored.

```sh
rustbelt-census affluence --zips-file fixtures/zips.txt
```

### State collection

Fetch all ZCTAs in a state:

```sh
rustbelt-census affluence --state OH
```

Combine with ZIPs to filter within the state:

```sh
rustbelt-census affluence --state PA --zips 19103,19104
```

## Output schema

Each row includes:

Required fields:
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
- `OccupiedCount`
- `HHCount_100kPlus`
- `HHCountTotal`

## Output formatting rules

- CSV includes a header row.
- When `--emit-sqlite-ready` is enabled, NULLs are emitted as empty fields.
- ZIPs are emitted as strings to preserve leading zeros.
- `--format jsonl` writes one JSON object per line.

## Exit codes

- `0` success (output emitted)
- `2` usage error (invalid ZIP, invalid state, missing input mode)
- `3` upstream fetch failure (e.g., failed ACS vintage discovery)

## Examples

Write JSONL output to a file:

```sh
rustbelt-census affluence --state PA --format jsonl --out pa_zcta_affluence.jsonl
```

Fetch ZIPs from a file and save CSV:

```sh
rustbelt-census affluence --zips-file fixtures/zips.txt --out zcta_patch.csv
```

## See also

- [Functional spec](rb-census-functional-spec.md)
- [Technical plan](rb-census-technical-plan.md)
