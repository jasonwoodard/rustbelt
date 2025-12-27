import csv
import json
from typing import Iterable, List, Mapping, Optional, TextIO

BASE_FIELDS = [
    "Zip",
    "Name",
    "MedianIncome",
    "PctHH_100kPlus",
    "PctRenters",
    "Population",
    "AcsYear",
    "Dataset",
    "FetchedAtUtc",
    "Status",
    "ErrorMessage",
]

AUDIT_FIELDS = [
    "RentersCount",
    "OccupiedCount",
    "HHCount_100kPlus",
    "HHCountTotal",
]


def build_fieldnames(include_audit_fields: bool) -> List[str]:
    if include_audit_fields:
        return BASE_FIELDS + AUDIT_FIELDS
    return BASE_FIELDS


def format_csv_value(value: object, precision: int, emit_sqlite_ready: bool) -> str:
    if value is None:
        return "" if emit_sqlite_ready else "null"
    if isinstance(value, float):
        return f"{value:.{precision}f}"
    return str(value)


def write_csv(
    rows: Iterable[Mapping[str, object]],
    handle: TextIO,
    include_audit_fields: bool,
    precision: int,
    emit_sqlite_ready: bool,
) -> None:
    fieldnames = build_fieldnames(include_audit_fields)
    writer = csv.DictWriter(handle, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        formatted = {
            key: format_csv_value(row.get(key), precision, emit_sqlite_ready)
            for key in fieldnames
        }
        writer.writerow(formatted)


def write_jsonl(rows: Iterable[Mapping[str, object]], handle: TextIO) -> None:
    for row in rows:
        handle.write(json.dumps(row, sort_keys=False))
        handle.write("\n")


def write_rows(
    rows: Iterable[Mapping[str, object]],
    handle: TextIO,
    output_format: str,
    include_audit_fields: bool,
    precision: int,
    emit_sqlite_ready: bool,
) -> None:
    if output_format == "csv":
        write_csv(rows, handle, include_audit_fields, precision, emit_sqlite_ready)
        return
    if output_format == "jsonl":
        write_jsonl(rows, handle)
        return
    raise ValueError(f"Unsupported format '{output_format}'.")
