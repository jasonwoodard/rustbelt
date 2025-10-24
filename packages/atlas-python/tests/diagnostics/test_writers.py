"""Tests for diagnostics output writers."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from atlas.diagnostics import (
    DIAGNOSTICS_BASENAME,
    DIAGNOSTICS_VERSION,
    write_html,
    write_json,
    write_parquet,
)


def _expected_filename(extension: str) -> str:
    return f"{DIAGNOSTICS_BASENAME}{extension}"


def test_write_json_round_trip(tmp_path: Path) -> None:
    payload = {"summary": {"count": 10, "mean": 2.5}, "warnings": ["ok"]}

    path = write_json(payload, tmp_path)

    assert path.name == _expected_filename(".json")
    with path.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)

    assert loaded == payload


def test_write_html_round_trip(tmp_path: Path) -> None:
    html = "<html><body><h1>Diagnostics</h1></body></html>"

    path = write_html(html, tmp_path)

    assert path.name == _expected_filename(".html")
    assert path.read_text(encoding="utf-8") == html


def test_write_parquet_round_trip(tmp_path: Path) -> None:
    frame = pd.DataFrame({"anchor": ["A", "B"], "score": [1.0, 2.5]})

    path = write_parquet(frame, tmp_path)

    assert path.name == _expected_filename(".parquet")
    reloaded = pd.read_parquet(path)
    pd.testing.assert_frame_equal(reloaded, frame)


def test_write_rejects_unversioned_filename(tmp_path: Path) -> None:
    unversioned = tmp_path / "diagnostics.json"

    with pytest.raises(ValueError):
        write_json({}, unversioned)

    with pytest.raises(ValueError):
        write_parquet(pd.DataFrame(), unversioned.with_suffix(".parquet"))

    with pytest.raises(ValueError):
        write_html("", unversioned.with_suffix(".html"))


def test_write_accepts_explicit_versioned_filename(tmp_path: Path) -> None:
    explicit = tmp_path / _expected_filename(".json")

    path = write_json({}, explicit)

    assert path == explicit
    assert path.exists()

    assert path.parent.name == tmp_path.name

    # verify constant aligns with expectation for documentation and downstream consumers
    assert DIAGNOSTICS_VERSION in explicit.name
