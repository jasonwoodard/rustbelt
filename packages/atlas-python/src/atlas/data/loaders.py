"""Utilities for loading and validating Atlas datasets."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .schema import AFFLUENCE_SCHEMA, OBSERVATIONS_SCHEMA, STORES_SCHEMA, DatasetSchema

__all__ = [
    "MissingColumnsError",
    "load_affluence",
    "load_observations",
    "load_stores",
]


class MissingColumnsError(ValueError):
    """Raised when a dataset is missing required columns."""

    def __init__(self, schema: DatasetSchema, missing: list[str]):
        message = (
            f"{schema.name.title()} data is missing required columns: {', '.join(missing)}. "
            f"Expected columns include: {', '.join(schema.required_columns)}."
        )
        super().__init__(message)
        self.schema = schema
        self.missing = missing


def load_stores(path: str | Path) -> pd.DataFrame:
    """Load a stores dataset from CSV or JSON and validate required columns."""

    return _load_and_validate(path, STORES_SCHEMA)


def load_affluence(path: str | Path) -> pd.DataFrame:
    """Load affluence covariates from CSV or JSON and validate required columns."""

    return _load_and_validate(path, AFFLUENCE_SCHEMA)


def load_observations(path: str | Path) -> pd.DataFrame:
    """Load visit observations from CSV or JSON and validate required columns."""

    return _load_and_validate(path, OBSERVATIONS_SCHEMA)


def _load_and_validate(path_like: str | Path, schema: DatasetSchema) -> pd.DataFrame:
    path = Path(path_like)
    frame = _read_structured_file(path, schema)
    missing = schema.missing_required(frame.columns)
    if missing:
        raise MissingColumnsError(schema, missing)
    return schema.coerce_dtypes(frame)


def _read_structured_file(path: Path, schema: DatasetSchema) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, dtype=schema.dtype_for_read())
    if suffix == ".json":
        return _read_json(path)
    raise ValueError(f"Unsupported file type '{suffix}' for {schema.name} data")


def _read_json(path: Path) -> pd.DataFrame:
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return pd.DataFrame()
    if raw[0] == "{":
        return pd.read_json(path, lines=True)
    return pd.read_json(path)
