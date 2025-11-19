"""Utilities for loading and validating Atlas datasets."""

from __future__ import annotations

from pathlib import Path
import re

import numpy as np
import pandas as pd

from .schema import AFFLUENCE_SCHEMA, OBSERVATIONS_SCHEMA, STORES_SCHEMA, DatasetSchema

__all__ = [
    "MissingColumnsError",
    "normalise_geo_id",
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

    frame = _load_and_validate(path, STORES_SCHEMA)
    if "GeoId" in frame.columns:
        frame = frame.copy()
        frame["GeoId"] = normalise_geo_id(frame["GeoId"])
    return frame


def normalise_geo_id(series: pd.Series) -> pd.Series:
    def _convert(value: object) -> str | pd._libs.missing.NAType:
        if pd.isna(value):
            return pd.NA
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return pd.NA
            if match := re.fullmatch(r"(\d+)\.0+", stripped):
                return match.group(1)
            return stripped
        if isinstance(value, (int, np.integer)):
            return str(value)
        if isinstance(value, (float, np.floating)):
            if float(value).is_integer():
                return str(int(value))
            return format(float(value), "g")
        return str(value)

    return series.map(_convert).astype("string")


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
