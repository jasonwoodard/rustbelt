#!/usr/bin/env python3
"""Inject Atlas scores into a Rustbelt trip JSON file.

Reads a scored-stores.csv produced by ``rustbelt-atlas score`` and writes
the Composite score (falling back to Value) into the ``score`` field of each
matching store in a trip JSON file.

Usage:
    python3 scripts/inject_scores.py \\
        --scores out/Florida-Set/scored-stores.csv \\
        --trip trips/florida-2026.json \\
        --out trips/florida-2026-scored.json

Or via the Makefile:
    make inject BATCH=Florida-Set TRIP=trips/florida-2026.json
"""

import argparse
import csv
import json
import os
import sys


def load_scores(path: str) -> dict[str, float]:
    """Return {StoreId: score} from a scored-stores CSV.

    Uses the ``Composite`` column when present; falls back to ``Value``.
    """
    scores: dict[str, float] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            store_id = row.get("StoreId", "").strip()
            if not store_id:
                continue
            raw = row.get("Composite") or row.get("Value") or ""
            try:
                scores[store_id] = float(raw)
            except ValueError:
                pass  # null / empty composite — skip
    return scores


def inject(trip: dict, scores: dict[str, float]) -> tuple[int, int, list[str]]:
    """Mutate *trip* in place, returning (matched, total, unmatched_ids)."""
    total = 0
    matched = 0
    unmatched: list[str] = []

    for store in trip.get("stores", []):
        store_id = store.get("id", "")
        total += 1
        if store_id in scores:
            store["score"] = scores[store_id]
            matched += 1
        else:
            unmatched.append(store_id)

    return matched, total, unmatched


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--scores",
        required=True,
        metavar="PATH",
        help="scored-stores.csv from rustbelt-atlas score",
    )
    parser.add_argument(
        "--trip",
        required=True,
        metavar="PATH",
        help="Input trip JSON file",
    )
    parser.add_argument(
        "--out",
        required=True,
        metavar="PATH",
        help="Output path for the scored trip JSON",
    )
    args = parser.parse_args(argv)

    if not os.path.isfile(args.scores):
        print(f"Error: scores file not found: {args.scores}", file=sys.stderr)
        return 1
    if not os.path.isfile(args.trip):
        print(f"Error: trip file not found: {args.trip}", file=sys.stderr)
        return 1

    scores = load_scores(args.scores)
    if not scores:
        print(f"Warning: no scores loaded from {args.scores}", file=sys.stderr)

    with open(args.trip, encoding="utf-8") as fh:
        trip = json.load(fh)

    matched, total, unmatched = inject(trip, scores)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(trip, fh, indent=2)

    print(f"Injecting Atlas scores → {args.out}")
    print(f"  Matched:   {matched} / {total} stores")
    if unmatched:
        print(f"  Unmatched: {', '.join(unmatched)}")
        print(f"             (no score — solver uses λ=0 objective for these)")
    print(f"  Written:   {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
