"""Synthetic datasets for integration and regression testing.

This module exposes helper utilities to locate fixture files bundled with
``atlas-python``. Fixtures are organised in sub-directories that each contain
``stores.csv`` alongside optional ``affluence.csv`` and ``observations.csv``
files.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

_FIXTURES_ROOT = Path(__file__).resolve().parent


def available_fixtures() -> list[str]:
    """Return the names of the fixture scenarios that ship with the package."""

    return sorted(entry.name for entry in _FIXTURES_ROOT.iterdir() if entry.is_dir())


def fixture_path(name: str, dataset: str) -> Path:
    """Return the the absolute path to a fixture dataset.

    Parameters
    ----------
    name:
        Name of the fixture scenario (e.g., ``"dense_urban"``).
    dataset:
        Dataset to load from the fixture directory. The ``.csv`` suffix is
        optional.
    """

    normalised = dataset if dataset.endswith(".csv") else f"{dataset}.csv"
    path = _FIXTURES_ROOT / name / normalised
    if not path.exists():
        available = ", ".join(available_fixtures())
        raise FileNotFoundError(
            f"Dataset '{dataset}' not found for fixture '{name}'. Available fixtures: {available}"
        )
    return path


def iter_fixture_datasets(name: str) -> Iterable[Path]:
    """Yield all CSV datasets available for ``name``."""

    directory = _FIXTURES_ROOT / name
    if not directory.is_dir():
        available = ", ".join(available_fixtures())
        raise FileNotFoundError(
            f"Fixture '{name}' not found. Available fixtures: {available}"
        )
    yield from sorted(directory.glob("*.csv"))


__all__ = ["available_fixtures", "fixture_path", "iter_fixture_datasets"]
