from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from atlas.cli.__main__ import (
    MODE_BLENDED,
    MODE_POSTERIOR,
    MODE_PRIOR,
    build_parser,
    main,
    _handle_score,
)
from atlas.explain.trace import TRACE_SCHEMA_VERSION


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


def test_score_parser_trace_defaults() -> None:
    parser = build_parser()
    args = parser.parse_args([
        "score",
        "--mode",
        MODE_PRIOR,
        "--stores",
        "stores.csv",
        "--output",
        "scores.csv",
    ])

    assert args.trace_format == "jsonl"
    assert args.posterior_trace_format == "csv"
    assert args.include_prior_trace is True
    assert args.include_posterior_trace is True
    assert args.include_blend_trace is True


def test_score_parser_trace_toggles() -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "score",
            "--mode",
            MODE_PRIOR,
            "--stores",
            "stores.csv",
            "--output",
            "scores.csv",
            "--trace-format",
            "csv",
            "--no-include-posterior-trace",
        ]
    )

    assert args.trace_format == "csv"
    assert args.include_posterior_trace is False


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

    omega = 0.25

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
            "--omega",
            str(omega),
        ]
    )

    scores = pd.read_csv(output_path)
    assert {"StoreId", "Value", "Yield", "Composite", "Omega"}.issubset(scores.columns)
    assert {"ValuePrior", "YieldPrior", "ValuePosterior", "YieldPosterior"}.issubset(scores.columns)
    assert not scores.empty

    indexed = scores.set_index("StoreId")
    blended_store = indexed.loc["S1"]
    assert blended_store["Omega"] == pytest.approx(omega)

    expected_value = (1 - omega) * blended_store["ValuePrior"] + omega * blended_store["ValuePosterior"]
    expected_yield = (1 - omega) * blended_store["YieldPrior"] + omega * blended_store["YieldPosterior"]
    assert blended_store["Value"] == pytest.approx(expected_value)
    assert blended_store["Yield"] == pytest.approx(expected_yield)

    expected_composite = max(1.0, min(5.0, (0.6 * blended_store["Value"]) + (0.4 * blended_store["Yield"])))
    assert blended_store["Composite"] == pytest.approx(expected_composite)

    blended_mask = indexed["ValuePosterior"].notna() & indexed["YieldPosterior"].notna()
    if blended_mask.any():
        expected = [omega] * int(blended_mask.sum())
        assert indexed.loc[blended_mask, "Omega"].tolist() == pytest.approx(expected)

    prior_only_mask = ~indexed["ValuePosterior"].notna()
    if prior_only_mask.any():
        zeros = [0.0] * int(prior_only_mask.sum())
        assert indexed.loc[prior_only_mask, "Omega"].tolist() == pytest.approx(zeros)

    trace_lines = trace_path.read_text(encoding="utf-8").strip().splitlines()
    assert trace_lines
    records = [json.loads(line) for line in trace_lines]
    first_trace = records[0]
    assert first_trace["metadata.schema_version"] == TRACE_SCHEMA_VERSION
    assert "store_id" in first_trace
    assert "scores.value" in first_trace or "scores.value_final" in first_trace

    blend_trace = next(record for record in records if record.get("stage") == "blend" and record.get("store_id") == "S1")
    assert blend_trace["observations.omega"] == pytest.approx(omega)
    assert blend_trace["scores.value_prior"] == pytest.approx(blended_store["ValuePrior"])
    assert blend_trace["scores.value_posterior"] == pytest.approx(blended_store["ValuePosterior"])
    assert blend_trace["scores.yield_prior"] == pytest.approx(blended_store["YieldPrior"])
    assert blend_trace["scores.yield_posterior"] == pytest.approx(blended_store["YieldPosterior"])

    posterior_df = pd.read_csv(posterior_trace)
    assert {"StoreId", "Theta", "Yield", "Value"}.issubset(posterior_df.columns)
    assert ecdf_cache.exists()


def test_handle_score_honours_trace_flags(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "score",
            "--mode",
            MODE_BLENDED,
            "--stores",
            "stores.csv",
            "--observations",
            "observations.csv",
            "--output",
            str(tmp_path / "scores.csv"),
            "--trace-out",
            str(tmp_path / "combined.csv"),
            "--posterior-trace",
            str(tmp_path / "posterior.jsonl"),
            "--trace-format",
            "csv",
            "--posterior-trace-format",
            "jsonl",
            "--no-include-prior-trace",
        ]
    )

    stores_df = pd.DataFrame(
        {
            "StoreId": ["S1"],
            "Type": ["Thrift"],
            "MedianIncomeNorm": [0.5],
            "Pct100kHHNorm": [0.4],
            "PctRenterNorm": [0.3],
        }
    )

    observations_df = pd.DataFrame({"StoreId": ["S1"], "Value": [1.0]})

    def fake_load_dataset(loader, location: str, label: str) -> pd.DataFrame:
        if label == "stores":
            return stores_df
        if label == "observations":
            return observations_df
        raise AssertionError(f"Unexpected label: {label}")

    monkeypatch.setattr("atlas.cli.__main__._load_dataset", fake_load_dataset)

    def fake_run_posterior_pipeline(*args, **kwargs):
        predictions = pd.DataFrame(
            {"StoreId": ["S1"], "Value": [1.5], "Yield": [2.0]}
        )
        trace_rows = [
            {
                "stage": "posterior",
                "store_id": "S1",
                "metadata.schema_version": TRACE_SCHEMA_VERSION,
            }
        ]
        return object(), predictions, trace_rows

    monkeypatch.setattr(
        "atlas.cli.__main__._run_posterior_pipeline",
        fake_run_posterior_pipeline,
    )

    def fake_run_prior_scoring(*args, **kwargs):
        frame = pd.DataFrame(
            {
                "StoreId": ["S1"],
                "Value": [1.0],
                "Yield": [1.2],
                "Composite": [1.1],
            }
        )
        trace = [
            {
                "stage": "prior",
                "store_id": "S1",
                "metadata.schema_version": TRACE_SCHEMA_VERSION,
            }
        ]
        return frame, trace

    monkeypatch.setattr("atlas.cli.__main__._run_prior_scoring", fake_run_prior_scoring)

    trace_calls: list[dict[str, object]] = []

    def fake_write_trace(records, path, *, format_hint):
        trace_calls.append(
            {
                "path": Path(path),
                "format": format_hint,
                "records": list(records),
            }
        )

    monkeypatch.setattr("atlas.cli.__main__._write_trace", fake_write_trace)
    monkeypatch.setattr("atlas.cli.__main__._write_table", lambda frame, path: None)

    _handle_score(args)

    assert len(trace_calls) == 2
    combined_call = next(call for call in trace_calls if call["path"].name == "combined.csv")
    posterior_call = next(call for call in trace_calls if call["path"].name == "posterior.jsonl")

    assert combined_call["format"] == "csv"
    assert {record["stage"] for record in combined_call["records"]} == {"posterior", "blend"}
    assert all(
        record["metadata.schema_version"] == TRACE_SCHEMA_VERSION
        for record in combined_call["records"]
    )

    assert posterior_call["format"] == "jsonl"
    assert {record["stage"] for record in posterior_call["records"]} == {"posterior"}
def test_score_rejects_invalid_omega(tmp_path: Path) -> None:
    stores_path = tmp_path / "stores.csv"
    output_path = tmp_path / "scores.csv"

    stores = pd.DataFrame(
        {
            "StoreId": ["S1"],
            "Name": ["Store 1"],
            "Type": ["Thrift"],
            "Lat": [42.0],
            "Lon": [-83.0],
            "MedianIncomeNorm": [0.5],
            "Pct100kHHNorm": [0.4],
            "PctRenterNorm": [0.3],
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
                str(output_path),
                "--omega",
                "1.5",
            ]
        )

    assert "ω" in str(excinfo.value)


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
