"""rustbelt-discover — CLI entry point."""

import argparse
import logging
import os
import sqlite3
import sys
import time

import requests

from discover.places import GooglePlacesClient
from discover.ingest import ingest_store
from discover.report import RunStats, format_report, format_zips_file
from discover.types import (
    ALL_TYPE_KEYS,
    MILES_TO_METERS,
    MAX_RADIUS_METERS,
    SEARCH_TERMS,
)

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rustbelt-discover",
        description="Discover stores via Google Places API and ingest into storedb.",
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude of search center.")
    parser.add_argument("--lon", type=float, required=True, help="Longitude of search center.")
    parser.add_argument("--radius", type=float, required=True, help="Search radius in miles (max ~31).")
    parser.add_argument(
        "--db",
        default="storedb/rustbelt.db",
        help="Path to SQLite database (default: storedb/rustbelt.db).",
    )
    parser.add_argument(
        "--api-key-env",
        default="GOOGLE_PLACES_API_KEY",
        help="Env var containing the Google Places API key (default: GOOGLE_PLACES_API_KEY).",
    )
    parser.add_argument(
        "--types",
        default=None,
        help=(
            "Comma-separated store type keys to search "
            f"(default: all — {', '.join(sorted(ALL_TYPE_KEYS))})."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run all API calls and print report; do not write to DB.",
    )
    parser.add_argument(
        "--zips-out",
        default="discover-zips.txt",
        help="Output file for new ZIPs (use '-' for stdout; default: discover-zips.txt).",
    )
    parser.add_argument(
        "--report-out",
        default=None,
        help="Output file for summary report (default: stdout).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=20,
        help="HTTP timeout in seconds (default: 20).",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="HTTP retry count on transient failures (default: 3).",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    # --- Validate radius ---
    radius_meters = args.radius * MILES_TO_METERS
    if radius_meters > MAX_RADIUS_METERS:
        print(
            f"Error: --radius {args.radius} exceeds the Google Places API maximum"
            " of ~31 miles (50,000m).",
            file=sys.stderr,
        )
        return 2

    # --- Resolve API key ---
    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        print(
            f"Error: environment variable '{args.api_key_env}' is not set.",
            file=sys.stderr,
        )
        return 1

    # --- Resolve search terms ---
    if args.types:
        requested_keys = {k.strip() for k in args.types.split(",")}
        unknown = requested_keys - ALL_TYPE_KEYS
        if unknown:
            print(
                f"Error: unknown store type(s): {', '.join(sorted(unknown))}. "
                f"Valid types: {', '.join(sorted(ALL_TYPE_KEYS))}.",
                file=sys.stderr,
            )
            return 2
        active_terms = [(k, t, st) for k, t, st in SEARCH_TERMS if k in requested_keys]
    else:
        active_terms = SEARCH_TERMS

    # --- Search phase ---
    session = requests.Session()
    client = GooglePlacesClient(
        session=session,
        api_key=api_key,
        timeout=args.timeout,
        retries=args.retries,
    )

    # Collect all candidates across all search terms
    all_candidates: list[tuple[str, str]] = []  # (place_id, store_type)
    raw_count = 0

    for _type_key, search_text, store_type in active_terms:
        candidates = client.nearby_search(
            lat=args.lat,
            lon=args.lon,
            radius_meters=radius_meters,
            search_text=search_text,
        )
        raw_count += len(candidates)
        for c in candidates:
            all_candidates.append((c.place_id, store_type))

    # Deduplicate by place_id — first matching search term wins
    seen: dict[str, str] = {}
    for place_id, store_type in all_candidates:
        if place_id not in seen:
            seen[place_id] = store_type
    unique_places = list(seen.items())  # [(place_id, store_type)]

    # --- Details phase ---
    errors: list[str] = []
    details_list = []

    for place_id, store_type in unique_places:
        detail = client.place_details(place_id=place_id, store_type=store_type)

        if detail is None:
            errors.append(
                f"[skip] '{place_id}': Place Details request failed"
            )
            continue

        if not detail.formatted_address or not detail.zip:
            errors.append(
                f"[skip] '{detail.display_name}': No address in response — cannot determine ZIP"
            )
            continue

        details_list.append(detail)

    # --- Build stats ---
    stats = RunStats(
        lat=args.lat,
        lon=args.lon,
        radius_miles=args.radius,
        search_term_count=len(active_terms),
        raw_result_count=raw_count,
        unique_place_count=len(unique_places),
        details_fetched=len(details_list),
        errors=errors,
        nearby_search_calls=client.nearby_search_calls,
        place_details_calls=client.place_details_calls,
        hours_with_data=sum(1 for d in details_list if d.has_hours),
    )
    stats.skipped = len(errors)

    # --- DB writes (live run only) ---
    if not args.dry_run:
        try:
            conn = sqlite3.connect(args.db)
        except sqlite3.OperationalError as exc:
            print(f"Error: cannot open database '{args.db}': {exc}", file=sys.stderr)
            return 1

        conn.execute("PRAGMA foreign_keys = ON")
        # Use autocommit mode — savepoints handle per-store rollback
        conn.isolation_level = None

        try:
            for detail in details_list:
                outcome, store_pk = ingest_store(conn, detail)
                if outcome == "inserted":
                    stats.inserted += 1
                    if detail.zip:
                        stats.new_zips.append(detail.zip)
                elif outcome == "updated":
                    stats.updated += 1
                else:
                    stats.skipped += 1
                    stats.errors.append(
                        f"[skip] '{detail.display_name}': DB write failed"
                    )
                    continue
                stats.type_counts[detail.store_type] = (
                    stats.type_counts.get(detail.store_type, 0) + 1
                )
        finally:
            conn.close()
    else:
        # Dry run — tally type counts from fetched details
        for detail in details_list:
            stats.type_counts[detail.store_type] = (
                stats.type_counts.get(detail.store_type, 0) + 1
            )

    # --- Print report ---
    report_text = format_report(stats, dry_run=args.dry_run)

    if args.report_out:
        with open(args.report_out, "w", encoding="utf-8") as fh:
            fh.write(report_text + "\n")
    else:
        print(report_text)

    # --- Write ZIPs file (live run only) ---
    if not args.dry_run and stats.new_zips:
        zips_content = format_zips_file(stats)
        if args.zips_out == "-":
            print(zips_content, end="")
        else:
            with open(args.zips_out, "w", encoding="utf-8") as fh:
                fh.write(zips_content)

    # --- Exit code ---
    if args.dry_run:
        return 0 if details_list else 1

    if stats.inserted > 0 or stats.updated > 0:
        return 0
    if stats.skipped > 0 and stats.inserted == 0 and stats.updated == 0:
        return 1
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.WARNING,
        format="%(levelname)s: %(message)s",
    )
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(run(args))


if __name__ == "__main__":
    main()
