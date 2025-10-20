"""Command-line entry point for the Atlas prototype."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from atlas.scoring import compute_prior_score


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rustbelt-atlas",
        description="Prototype CLI for the Rust Belt Atlas scoring engine",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print the prototype version tag",
    )
    parser.add_argument(
        "--explain",
        action="store_true",
        help="Emit detailed trace outputs for explainability experiments",
    )
    parser.add_argument(
        "--trace-dir",
        default=".",
        help="Directory where trace JSON/CSV files should be written when --explain is set.",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.version:
        print("atlas-python 0.1.0-prototype")
        return

    if args.explain:
        trace_dir = Path(args.trace_dir)
        trace_dir.mkdir(parents=True, exist_ok=True)
        json_path = trace_dir / "atlas-trace.json"
        csv_path = trace_dir / "atlas-trace.csv"

        sample = compute_prior_score(
            "Thrift",
            median_income_norm=0.5,
            pct_hh_100k_norm=0.4,
            pct_renter_norm=0.3,
            lambda_weight=0.5,
        )
        records = [sample.to_trace()]

        json_path.write_text(json.dumps(records, indent=2, sort_keys=True))

        if records:
            fieldnames = sorted(records[0].keys())
        else:  # pragma: no cover - defensive fallback
            fieldnames = []

        with csv_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)

        print(f"Wrote trace data to {json_path} and {csv_path}")
        return

    print(
        "Rust Belt Atlas prototype is ready for implementation. "
        "Add scoring logic in packages/atlas-python/src/atlas/."
    )


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
