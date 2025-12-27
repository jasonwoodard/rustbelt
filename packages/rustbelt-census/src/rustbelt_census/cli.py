import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

import requests

from rustbelt_census.cache import get_cache_dir
from rustbelt_census.census_api import (
    ApiError,
    DATASET,
    ZCTA_FIELD,
    discover_latest_acs5_year,
    fetch_state_zcta_rows,
    fetch_zcta_row,
)
from rustbelt_census.derive import pct_hh_100k_plus, pct_renters
from rustbelt_census.formatters import write_rows
from rustbelt_census.state_map import get_state_fips, get_state_ucgid


class UsageError(ValueError):
    pass


def normalize_zips(zips: Iterable[str]) -> list[str]:
    normalized = []
    seen = set()
    for zip_code in zips:
        cleaned = zip_code.strip()
        if not cleaned:
            continue
        if len(cleaned) != 5 or not cleaned.isdigit():
            raise UsageError(f"Invalid ZIP '{zip_code}'. ZIPs must be 5 digits.")
        if cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized


def load_zips_file(path: Path) -> list[str]:
    zips = []
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        zips.append(stripped)
    return normalize_zips(zips)


def parse_zip_inputs(zips_arg: Optional[str], zips_file: Optional[str]) -> list[str]:
    values: list[str] = []
    if zips_arg:
        values.extend([item for item in zips_arg.split(",")])
    if zips_file:
        try:
            values.extend(load_zips_file(Path(zips_file)))
        except FileNotFoundError as exc:
            raise UsageError(f"ZIP file not found: {zips_file}") from exc
    return normalize_zips(values)


def parse_int(value: Optional[str]) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def build_row(
    raw: dict[str, str],
    zip_code: str,
    year: int,
    fetched_at: str,
    precision: int,
) -> dict[str, object]:
    median_income = parse_int(raw.get("B19013_001E"))
    population = parse_int(raw.get("B01003_001E"))
    occupied = parse_int(raw.get("B25003_001E"))
    renters = parse_int(raw.get("B25003_003E"))
    hh_total = parse_int(raw.get("B19001_001E"))
    hh_bins = [
        parse_int(raw.get("B19001_013E")),
        parse_int(raw.get("B19001_014E")),
        parse_int(raw.get("B19001_015E")),
        parse_int(raw.get("B19001_016E")),
        parse_int(raw.get("B19001_017E")),
    ]
    hh_values = [value for value in hh_bins if value is not None]
    hh_over_100k = sum(hh_values) if hh_values else None

    errors = []
    status = "ok"

    pct_renters_value, pct_renters_error = pct_renters(renters, occupied, precision)
    if pct_renters_error:
        errors.append(pct_renters_error)
    pct_hh_value, pct_hh_error = pct_hh_100k_plus(hh_over_100k, hh_total, precision)
    if pct_hh_error:
        errors.append(pct_hh_error)

    if median_income is None:
        errors.append("Missing median income.")
    if population is None:
        errors.append("Missing population.")

    if errors:
        status = "missing"

    return {
        "Zip": zip_code,
        "Name": raw.get("NAME"),
        "MedianIncome": median_income,
        "PctHH_100kPlus": pct_hh_value,
        "PctRenters": pct_renters_value,
        "Population": population,
        "AcsYear": year,
        "Dataset": DATASET,
        "FetchedAtUtc": fetched_at,
        "Status": status,
        "ErrorMessage": "; ".join(errors) if errors else None,
        "RentersCount": renters,
        "OccupiedCount": occupied,
        "HHCount_100kPlus": hh_over_100k,
        "HHCountTotal": hh_total,
    }


def build_error_row(zip_code: str, year: int, fetched_at: str, message: str) -> dict[str, object]:
    return {
        "Zip": zip_code,
        "Name": None,
        "MedianIncome": None,
        "PctHH_100kPlus": None,
        "PctRenters": None,
        "Population": None,
        "AcsYear": year,
        "Dataset": DATASET,
        "FetchedAtUtc": fetched_at,
        "Status": "error",
        "ErrorMessage": message,
        "RentersCount": None,
        "OccupiedCount": None,
        "HHCount_100kPlus": None,
        "HHCountTotal": None,
    }


def build_missing_row(zip_code: str, year: int, fetched_at: str, message: str) -> dict[str, object]:
    row = build_error_row(zip_code, year, fetched_at, message)
    row["Status"] = "missing"
    return row


def summarize_rows(rows: Iterable[dict[str, object]]) -> tuple[int, int, int]:
    ok = sum(1 for row in rows if row.get("Status") == "ok")
    missing = sum(1 for row in rows if row.get("Status") == "missing")
    error = sum(1 for row in rows if row.get("Status") == "error")
    return ok, missing, error


def run_affluence(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    zip_list = parse_zip_inputs(args.zips, args.zips_file)
    if not zip_list and not args.state:
        parser.print_help(sys.stderr)
        raise UsageError("At least one input mode is required: --state, --zips, or --zips-file.")

    state_fips = None
    state_ucgid = None
    if args.state:
        try:
            state_fips = get_state_fips(args.state)
            state_ucgid = get_state_ucgid(args.state)
        except ValueError as exc:
            raise UsageError(str(exc)) from exc

    cache_dir = get_cache_dir(args.cache_dir)
    session = requests.Session()
    api_key = None
    if args.api_key_env:
        api_key = os.environ.get(args.api_key_env)

    try:
        latest_cache = cache_dir / "latest_acs5_year.json"
        year, year_cache_hit = discover_latest_acs5_year(
            session,
            latest_cache,
            timeout=args.timeout,
            retries=args.retries,
            cache_ttl_days=21,
        )
    except ApiError as exc:
        raise ApiError(
            "Failed to discover latest ACS vintage from api.census.gov/data.json. "
            "Try again or set CENSUS_API_KEY."
        ) from exc

    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    print(f"Using ACS vintage: {year} ({DATASET})", file=sys.stderr)
    if year_cache_hit:
        print("Cache hit: latest ACS year", file=sys.stderr)

    rows: list[dict[str, object]] = []

    if state_fips:
        print(
            f"Fetching ZCTAs for state={args.state.upper()} (ucgid={state_ucgid})",
            file=sys.stderr,
        )
        state_cache = cache_dir / f"state_collection_{year}_{state_fips}.json"
        result = fetch_state_zcta_rows(
            session,
            year,
            state_ucgid,
            state_cache,
            timeout=args.timeout,
            retries=args.retries,
            cache_ttl_days=7,
            api_key=api_key,
        )
        if result.cache_hit:
            print("Cache hit: state collection", file=sys.stderr)
        raw_rows = result.rows
        rows_by_zip = {row.get(ZCTA_FIELD): row for row in raw_rows}

        if zip_list:
            for zip_code in zip_list:
                raw = rows_by_zip.get(zip_code)
                if raw is None:
                    rows.append(
                        build_missing_row(
                            zip_code,
                            year,
                            fetched_at,
                            "ZIP not found in state dataset.",
                        )
                    )
                else:
                    rows.append(build_row(raw, zip_code, year, fetched_at, args.precision))
        else:
            for zip_code in sorted(rows_by_zip):
                rows.append(
                    build_row(rows_by_zip[zip_code], zip_code, year, fetched_at, args.precision)
                )
    else:
        print("Fetching ZCTAs for explicit ZIP list", file=sys.stderr)
        for zip_code in zip_list:
            try:
                raw = fetch_zcta_row(
                    session,
                    year,
                    zip_code,
                    timeout=args.timeout,
                    retries=args.retries,
                    api_key=api_key,
                )
                rows.append(build_row(raw, zip_code, year, fetched_at, args.precision))
            except ApiError as exc:
                rows.append(build_error_row(zip_code, year, fetched_at, str(exc)))

    ok, missing, error = summarize_rows(rows)
    print(
        f"Fetched {len(rows)} rows; emitted {len(rows)} rows; status: "
        f"ok={ok} missing={missing} error={error}",
        file=sys.stderr,
    )

    output_handle = sys.stdout
    if args.out:
        output_handle = open(args.out, "w", encoding="utf-8")

    try:
        write_rows(
            rows,
            output_handle,
            output_format=args.format,
            include_audit_fields=args.include_audit_fields,
            precision=args.precision,
            emit_sqlite_ready=args.emit_sqlite_ready,
        )
    finally:
        if output_handle is not sys.stdout:
            output_handle.close()
            print(f"Wrote output to {args.out}", file=sys.stderr)

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rustbelt-census",
        description="Fetch ACS 5-year ZCTA affluence metrics for Atlas.",
    )
    subparsers = parser.add_subparsers(dest="command")

    affluence = subparsers.add_parser(
        "affluence",
        help="Fetch ACS 5-year ZCTA affluence metrics.",
    )
    affluence.set_defaults(parser=affluence)
    affluence.add_argument("--zips", help="Comma-separated list of ZIP codes.")
    affluence.add_argument("--zips-file", help="Path to a ZIP list file.")
    affluence.add_argument("--state", help="Two-letter USPS state code.")
    affluence.add_argument("--out", help="Write output to a file path.")
    affluence.add_argument(
        "--format",
        choices=("csv", "jsonl"),
        default="csv",
        help="Output format (default: csv).",
    )
    affluence.add_argument(
        "--emit-sqlite-ready",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Emit SQLite-ready formatting (default: true).",
    )
    affluence.add_argument(
        "--include-audit-fields",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include audit fields (default: true).",
    )
    affluence.add_argument(
        "--cache-dir",
        help="Cache directory path (default: platform cache dir).",
    )
    affluence.add_argument(
        "--timeout",
        type=int,
        default=20,
        help="HTTP timeout in seconds (default: 20).",
    )
    affluence.add_argument(
        "--retries",
        type=int,
        default=3,
        help="HTTP retries (default: 3).",
    )
    affluence.add_argument(
        "--api-key-env",
        default="CENSUS_API_KEY",
        help="Environment variable containing Census API key (default: CENSUS_API_KEY).",
    )
    affluence.add_argument(
        "--precision",
        type=int,
        default=3,
        help="Percent precision (default: 3).",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help(sys.stderr)
        sys.exit(2)

    if args.command == "affluence":
        try:
            sys.exit(run_affluence(args, args.parser))
        except UsageError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(2)
        except ApiError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(3)

    parser.print_help(sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
