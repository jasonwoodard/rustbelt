from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from atlas.fixtures import fixture_path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PACKAGE_ROOT / "src"


def _run_cli(tmp_path: Path, arguments: list[str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    pythonpath = str(SRC_PATH)
    if existing := env.get("PYTHONPATH"):
        pythonpath = os.pathsep.join([pythonpath, existing])
    env["PYTHONPATH"] = pythonpath

    result = subprocess.run(
        [sys.executable, "-m", "atlas.cli", "score", *arguments],
        cwd=PACKAGE_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            "CLI invocation failed",
            result.args,
            result.stdout,
            result.stderr,
        )
    return result


@pytest.mark.integration
def test_cli_prior_dense_urban_fixture(tmp_path: Path) -> None:
    stores = fixture_path("dense_urban", "stores")
    output = tmp_path / "scores.csv"
    trace = tmp_path / "trace.jsonl"

    _run_cli(
        tmp_path,
        [
            "--mode",
            "prior-only",
            "--stores",
            str(stores),
            "--output",
            str(output),
            "--trace-out",
            str(trace),
            "--lambda",
            "0.5",
        ],
    )

    frame = pd.read_csv(output)
    assert {"StoreId", "Value", "Yield", "Composite"} <= set(frame.columns)
    assert len(frame) == 5
    assert frame["Value"].between(1.0, 5.0).all()
    assert frame["Yield"].between(1.0, 5.0).all()

    composite_expected = 0.5 * frame["Value"] + 0.5 * frame["Yield"]
    pd.testing.assert_series_equal(
        frame["Composite"],
        composite_expected,
        check_names=False,
        check_dtype=False,
        rtol=0.0,
        atol=1e-9,
    )

    trace_lines = trace.read_text(encoding="utf-8").strip().splitlines()
    assert len(trace_lines) == len(frame)
    first_record = json.loads(trace_lines[0])
    assert {"baseline_value", "baseline_yield", "income_contribution"} <= set(first_record)

    expected_composites = np.array([3.035, 3.0685, 3.2625, 3.35, 3.353])
    np.testing.assert_allclose(
        np.sort(frame["Composite"].to_numpy()),
        expected_composites,
        atol=1e-6,
        rtol=0.0,
    )


@pytest.mark.integration
def test_cli_blended_sparse_rural_fixture(tmp_path: Path) -> None:
    fixture_dir = fixture_path("sparse_rural", "stores").parent
    output = tmp_path / "blended.csv"
    trace = tmp_path / "trace.jsonl"
    posterior_trace = tmp_path / "posterior.csv"

    _run_cli(
        tmp_path,
        [
            "--mode",
            "blended",
            "--stores",
            str(fixture_dir / "stores.csv"),
            "--affluence",
            str(fixture_dir / "affluence.csv"),
            "--observations",
            str(fixture_dir / "observations.csv"),
            "--output",
            str(output),
            "--trace-out",
            str(trace),
            "--posterior-trace",
            str(posterior_trace),
            "--ecdf-window",
            "Metro",
            "--lambda",
            "0.4",
        ],
    )

    frame = pd.read_csv(output)
    required_columns = {
        "StoreId",
        "ValuePrior",
        "YieldPrior",
        "CompositePrior",
        "Value",
        "Yield",
        "Composite",
        "Cred",
        "Method",
        "ECDF_q",
    }
    assert required_columns <= set(frame.columns)
    assert frame["Value"].between(1.0, 5.0).all()
    assert frame["Yield"].between(1.0, 5.0).all()
    assert frame["Cred"].between(0.0, 1.0).all()
    assert frame["ECDF_q"].between(0.0, 1.0).all()
    assert frame["Method"].isin({"GLM", "Hier", "kNN"}).all()

    composite_expected = 0.4 * frame["Value"] + 0.6 * frame["Yield"]
    pd.testing.assert_series_equal(
        frame["Composite"],
        composite_expected,
        check_names=False,
        check_dtype=False,
        atol=1e-9,
        rtol=0.0,
    )

    trace_lines = trace.read_text(encoding="utf-8").strip().splitlines()
    assert len(trace_lines) == len(frame)

    posterior_df = pd.read_csv(posterior_trace)
    assert {"StoreId", "Theta", "Yield", "Value", "Cred", "Method"} <= set(posterior_df.columns)

    expected_composites = np.array([2.52, 3.56, 3.56, 3.92])
    np.testing.assert_allclose(
        np.sort(frame["Composite"].to_numpy()),
        expected_composites,
        atol=1e-6,
        rtol=0.0,
    )
