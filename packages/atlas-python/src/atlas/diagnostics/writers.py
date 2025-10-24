"""Output writers for Atlas diagnostics payloads."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Union

import pandas as pd


PathLike = Union[str, Path]
"""Supported path-like inputs accepted by diagnostics writers."""

DIAGNOSTICS_VERSION = "v0.2"
"""Version tag embedded in emitted diagnostics filenames."""

DIAGNOSTICS_BASENAME = f"atlas-diagnostics-{DIAGNOSTICS_VERSION}"
"""Base filename (without extension) used for diagnostics artifacts."""


def _resolve_target_path(target: PathLike, suffix: str) -> Path:
    """Resolve *target* to a concrete file path enforcing versioned filenames."""

    path = Path(target)
    expected_name = f"{DIAGNOSTICS_BASENAME}{suffix}"

    if path.suffix:
        if path.name != expected_name:
            raise ValueError(
                "Diagnostics outputs must use the versioned filename "
                f"'{expected_name}'."
            )
        resolved = path
    else:
        if path.exists() and path.is_file():
            raise ValueError(
                "Target path must be a directory or the explicit versioned filename."
            )
        resolved = path / expected_name

    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def write_json(payload: Mapping[str, Any], target: PathLike) -> Path:
    """Serialize a diagnostics payload to a JSON file with a versioned name."""

    path = _resolve_target_path(target, ".json")
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return path


def write_html(html: str, target: PathLike) -> Path:
    """Persist diagnostics HTML content to disk with a versioned name."""

    path = _resolve_target_path(target, ".html")
    path.write_text(html, encoding="utf-8")
    return path


def write_parquet(frame: pd.DataFrame, target: PathLike) -> Path:
    """Persist a diagnostics DataFrame to a Parquet file with a versioned name."""

    path = _resolve_target_path(target, ".parquet")
    frame.to_parquet(path, index=False)
    return path


__all__ = [
    "DIAGNOSTICS_BASENAME",
    "DIAGNOSTICS_VERSION",
    "PathLike",
    "write_html",
    "write_json",
    "write_parquet",
]
