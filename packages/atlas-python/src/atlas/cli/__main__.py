"""Command-line entry point for the Atlas prototype."""

from __future__ import annotations

import argparse


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
        help="Emit detailed tracing (placeholder)",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.version:
        print("atlas-python 0.1.0-prototype")
        return

    print(
        "Rust Belt Atlas prototype is ready for implementation. "
        "Add scoring logic in packages/atlas-python/src/atlas/."
    )


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
