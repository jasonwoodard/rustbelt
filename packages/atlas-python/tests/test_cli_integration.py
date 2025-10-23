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


def _run_cli(
    tmp_path: Path, arguments: list[str], *, command: str = "score"
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    pythonpath = str(SRC_PATH)
    if existing := env.get("PYTHONPATH"):
        pythonpath = os.pathsep.join([pythonpath, existing])
    env["PYTHONPATH"] = pythonpath

    result = subprocess.run(
        [sys.executable, "-m", "atlas.cli", command, *arguments],
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

    trace_lines = [line for line in trace.read_text(encoding="utf-8").splitlines() if line]
    assert len(trace_lines) == len(frame) * 2
    records = [json.loads(line) for line in trace_lines]
    stages = [record["stage"] for record in records]
    assert stages.count("prior") == len(frame)
    assert stages.count("blend") == len(frame)
    first_prior = next(record for record in records if record["stage"] == "prior")
    assert {"baseline_value", "baseline_yield", "income_contribution"} <= set(first_prior)

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

    trace_lines = [line for line in trace.read_text(encoding="utf-8").splitlines() if line]
    records = [json.loads(line) for line in trace_lines]
    stages = [record["stage"] for record in records]
    assert stages.count("prior") == len(frame)
    assert stages.count("blend") == len(frame)

    posterior_df = pd.read_csv(posterior_trace)
    assert {"StoreId", "Theta", "Yield", "Value", "Cred", "Method"} <= set(posterior_df.columns)

    expected_composites = np.array([2.7, 3.243333333333333, 3.343333333333333, 3.43])
    np.testing.assert_allclose(
        np.sort(frame["Composite"].to_numpy()),
        expected_composites,
        atol=1e-6,
        rtol=0.0,
    )


@pytest.mark.integration
def test_cli_anchors_detects_clusters(tmp_path: Path) -> None:
    stores = fixture_path("dense_urban", "stores")
    anchors_output = tmp_path / "anchors.csv"
    assignments_output = tmp_path / "assignments.csv"
    metrics_output = tmp_path / "metrics.json"

    _run_cli(
        tmp_path,
        [
            "--stores",
            str(stores),
            "--output",
            str(anchors_output),
            "--store-assignments",
            str(assignments_output),
            "--metrics",
            str(metrics_output),
            "--algorithm",
            "dbscan",
            "--eps",
            "0.03",
            "--min-samples",
            "2",
            "--metric",
            "euclidean",
            "--id-prefix",
            "metro-anchor",
        ],
        command="anchors",
    )

    anchors_df = pd.read_csv(anchors_output)
    assert {"anchor_id", "store_count", "centroid_lat", "centroid_lon"} <= set(anchors_df.columns)
    assert len(anchors_df) == 2
    assert set(anchors_df["anchor_id"]) == {"metro-anchor-001", "metro-anchor-002"}

    assignments_df = pd.read_csv(assignments_output)
    assert {"StoreId", "anchor_id"} <= set(assignments_df.columns)
    assert len(assignments_df) == 5
    assert assignments_df["anchor_id"].isin(anchors_df["anchor_id"]).all()

    metrics = json.loads(metrics_output.read_text(encoding="utf-8"))
    assert metrics["algorithm"] == "dbscan"
    assert metrics["num_anchors"] == 2
    assert metrics["noise_points"] == 0


@pytest.mark.integration
def test_cli_subclusters_materialises_hierarchy(tmp_path: Path) -> None:
    spec_path = tmp_path / "subclusters.json"
    spec = [
        {
            "key": "root",
            "store_ids": ["DU-001", "DU-002", "DU-003"],
        },
        {
            "key": "child-a",
            "parent_key": "root",
            "store_ids": ["DU-001"],
            "metadata": {"score": 0.8},
        },
        {
            "key": "child-b",
            "parent_key": "root",
            "store_ids": ["DU-002", "DU-003"],
            "metadata": {"score": 0.5},
        },
    ]
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    output = tmp_path / "subclusters.jsonl"

    _run_cli(
        tmp_path,
        [
            "--anchor-id",
            "metro-anchor-001",
            "--spec",
            str(spec_path),
            "--output",
            str(output),
            "--id-prefix",
            "metro-anchor-001-sc",
        ],
        command="subclusters",
    )

    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines() if line]
    assert len(records) == len(spec)
    assert {record["anchor_id"] for record in records} == {"metro-anchor-001"}

    root_record = records[0]
    assert root_record["lineage"] == "001"
    assert root_record["parent_subcluster_id"] is None
    assert root_record["store_count"] == 3

    child_records = records[1:]
    assert {child["parent_subcluster_id"] for child in child_records} == {root_record["subcluster_id"]}
    assert {child["lineage"] for child in child_records} == {"001.001", "001.002"}
    assert any(child["metadata"].get("score") == 0.8 for child in child_records)
