"""Utilities for validating Atlas CLI payloads against JSON schemas."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Mapping, MutableMapping, Sequence

import numpy as np
import pandas as pd
import jsonschema


SCHEMA_VERSION = "v1"
_SCHEMA_FILENAMES: Mapping[str, str] = {
    "score": "score.schema.json",
    "anchor": "anchor.schema.json",
    "cluster": "cluster.schema.json",
}


class SchemaValidationError(RuntimeError):
    """Raised when a payload fails validation against a JSON schema."""

    def __init__(self, schema: str, index: int, message: str) -> None:
        detail = f"{schema} record {index} failed validation: {message}"
        super().__init__(detail)
        self.schema = schema
        self.index = index
        self.message = message


class SchemaValidator:
    """Validate Atlas CLI payloads using the repository JSON schemas."""

    def __init__(self, *, schema_version: str = SCHEMA_VERSION) -> None:
        self.schema_version = schema_version

    def validate_frame(
        self,
        schema: str,
        frame: pd.DataFrame | None,
        *,
        string_fields: Sequence[str] = (),
    ) -> None:
        if frame is None or frame.empty:
            return
        records = _normalise_frame(frame, string_fields=string_fields)
        self.validate_records(schema, records)

    def validate_records(
        self,
        schema: str,
        records: Iterable[Mapping[str, object]],
    ) -> None:
        validator = _load_validator(schema, schema_version=self.schema_version)
        for index, record in enumerate(records):
            try:
                validator.validate(record)
            except jsonschema.ValidationError as exc:  # pragma: no cover - exercised in tests
                message = exc.message
                if exc.path:
                    path = ".".join(str(part) for part in exc.path)
                    message = f"{message} (path: {path})"
                raise SchemaValidationError(schema, index, message) from exc


@lru_cache(maxsize=None)
def _load_validator(schema: str, *, schema_version: str) -> jsonschema.Validator:
    filename = _SCHEMA_FILENAMES.get(schema)
    if filename is None:
        raise ValueError(f"Unknown schema type '{schema}'")

    schema_path = _schema_directory(schema_version) / filename
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file '{schema_path}' was not found")

    with schema_path.open(encoding="utf-8") as handle:
        payload = json.load(handle)

    return jsonschema.Draft202012Validator(payload)


@lru_cache(maxsize=None)
def _schema_directory(schema_version: str) -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "schema" / "atlas" / schema_version
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Could not locate schema directory for version '{schema_version}' starting from '{current}'"
    )


def _normalise_frame(
    frame: pd.DataFrame,
    *,
    string_fields: Sequence[str] = (),
) -> list[MutableMapping[str, object]]:
    sanitised = frame.copy()
    sanitised = sanitised.where(~sanitised.isna(), None)

    records = sanitised.to_dict(orient="records")
    normalised: list[MutableMapping[str, object]] = []
    string_fields = tuple(string_fields)

    for record in records:
        converted: MutableMapping[str, object] = {}
        for key, value in record.items():
            coerced = _coerce_value(value)
            if key in string_fields and coerced is not None:
                coerced = str(coerced)
            converted[key] = coerced
        normalised.append(converted)

    return normalised


def _coerce_value(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): _coerce_value(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_coerce_value(item) for item in value]

    if isinstance(value, pd.Series):  # pragma: no cover - defensive
        return [_coerce_value(item) for item in value.tolist()]

    if isinstance(value, np.generic):
        value = value.item()

    if value is None:
        return None

    if isinstance(value, float) and math.isnan(value):
        return None

    if pd.isna(value):  # pragma: no cover - fallback for pandas scalars
        return None

    return value


__all__ = [
    "SchemaValidationError",
    "SchemaValidator",
]
