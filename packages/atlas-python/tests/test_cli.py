from __future__ import annotations

import json
from pathlib import Path

from atlas.cli.__main__ import build_parser, main

import pandas as pd
import pytest

from atlas.cli.__main__ import MODE_BLENDED, MODE_POSTERIOR, MODE_PRIOR, build_parser, main


def test_parser_displays_help(capsys: pytest.CaptureFixture[str]) -> None:
    parser = build_parser()
    args = parser.parse_args(["--version"])
    assert args.version is True


def test_explain_flag_writes_trace_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    main(["--explain"])

    json_path = tmp_path / "atlas-trace.json"
    csv_path = tmp_path / "atlas-trace.csv"

    assert json_path.exists()
    assert csv_path.exists()

    data = json.loads(json_path.read_text())
    assert isinstance(data, list)
    assert data
    row = data[0]
    assert "baseline.value" in row
    assert "scores.value" in row
    with pytest.raises(SystemExit):
        parser.parse_args(["score", "--help"])
    captured = capsys.readouterr()
    assert "--mode" in captured.out
    assert "score" in captured.out


def test_version_flag_reports_package_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        main(["--version"])
    captured = capsys.readouterr()
    assert "atlas-python" in captured.out.strip()


def test_score_requires_observations_for_posterior(tmp_path: Path) -> None:
    stores_path = tmp_path / "stores.csv"
    stores = pd.DataFrame(
        {
            "StoreId": ["S1"],
            "Name": ["Store 1"],
            "Type": ["Thrift"],
            "Lat": [42.0],
            "Lon": [-83.0],
        }
    )
    stores.to_csv(stores_path, index=False)

    with pytest.raises(SystemExit) as excinfo:
        main([
            "score",
            "--mode",
            MODE_POSTERIOR,
            "--stores",
            str(stores_path),
            "--output",
            "out.csv",
        ])
    assert "Mode" in str(excinfo.value)


def test_score_cli_blended_mode(tmp_path: Path) -> None:
    stores_path = tmp_path / "stores.csv"
    affluence_path = tmp_path / "affluence.csv"
    observations_path = tmp_path / "observations.csv"
    output_path = tmp_path / "scores.csv"
    trace_path = tmp_path / "trace.jsonl"
    posterior_trace = tmp_path / "posterior.csv"
    ecdf_cache = tmp_path / "ecdf.parquet"

    stores = pd.DataFrame(
        {
            "StoreId": ["S1", "S2", "S3"],
            "Name": ["Store 1", "Store 2", "Store 3"],
            "Type": ["Thrift", "Antique", "Vintage"],
            "Lat": [42.0, 42.1, 42.2],
            "Lon": [-83.0, -83.1, -83.2],
            "GeoId": ["G1", "G2", "G1"],
            "Metro": ["Metro-1", "Metro-1", "Metro-2"],
        }
    )
    affluence = pd.DataFrame(
        {
            "GeoId": ["G1", "G2"],
            "MedianIncome": [50_000, 60_000],
            "Pct100kHH": [0.20, 0.25],
            "Education": [0.3, 0.4],
            "HomeValue": [150_000, 180_000],
            "Turnover": [0.30, 0.40],
            "Metro": ["Metro-1", "Metro-1"],
            "County": ["County-1", "County-1"],
        }
    )
    observations = pd.DataFrame(
        {
            "StoreId": ["S1", "S1", "S2"],
            "DateTime": ["2024-03-01T10:00:00", "2024-03-05T11:00:00", "2024-03-02T09:45:00"],
            "DwellMin": [45.0, 30.0, 60.0],
            "PurchasedItems": [3, 2, 5],
            "HaulLikert": [4.0, 3.0, 4.0],
        }
    )

    stores.to_csv(stores_path, index=False)
    affluence.to_csv(affluence_path, index=False)
    observations.to_csv(observations_path, index=False)

    main(
        [
            "score",
            "--mode",
            MODE_BLENDED,
            "--stores",
            str(stores_path),
            "--affluence",
            str(affluence_path),
            "--observations",
            str(observations_path),
            "--output",
            str(output_path),
            "--trace-out",
            str(trace_path),
            "--posterior-trace",
            str(posterior_trace),
            "--ecdf-window",
            "Metro",
            "--ecdf-cache",
            str(ecdf_cache),
            "--lambda",
            "0.6",
        ]
    )

    scores = pd.read_csv(output_path)
    assert {"StoreId", "Value", "Yield", "Composite"}.issubset(scores.columns)
    assert not scores.empty

    trace_lines = trace_path.read_text(encoding="utf-8").strip().splitlines()
    assert trace_lines
    first_trace = json.loads(trace_lines[0])
    assert "StoreId" in first_trace
    assert "value" in first_trace

    posterior_df = pd.read_csv(posterior_trace)
    assert {"StoreId", "Theta", "Yield", "Value"}.issubset(posterior_df.columns)
    assert ecdf_cache.exists()


def test_prior_mode_requires_normalised_columns(tmp_path: Path) -> None:
    stores_path = tmp_path / "stores.csv"
    stores = pd.DataFrame(
        {
            "StoreId": ["S1"],
            "Name": ["Store 1"],
            "Type": ["Thrift"],
            "Lat": [42.0],
            "Lon": [-83.0],
        }
    )
    stores.to_csv(stores_path, index=False)

    with pytest.raises(SystemExit) as excinfo:
        main(
            [
                "score",
                "--mode",
                MODE_PRIOR,
                "--stores",
                str(stores_path),
                "--output",
                str(tmp_path / "out.csv"),
            ]
        )
    assert "normalised" in str(excinfo.value)
