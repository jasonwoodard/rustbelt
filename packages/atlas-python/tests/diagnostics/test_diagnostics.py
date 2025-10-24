"""Unit tests for :mod:`atlas.diagnostics`."""

from __future__ import annotations

import pandas as pd
import pytest

from atlas.diagnostics import (
    compute_correlation_table,
    generate_qa_signals,
    summarize_distributions,
)


def test_compute_correlation_table_numeric_selection_and_minimum() -> None:
    frame = pd.DataFrame(
        {
            "component_a": [1.0, 2.0, 3.0, 4.0],
            "component_b": [4.0, 3.0, float("nan"), 1.0],
            "component_c": [float("nan")] * 4,
            "label": ["x", "y", "x", "y"],
        }
    )

    table = compute_correlation_table(frame, method="spearman", minimum_non_null=2)

    assert table["method"] == "spearman"
    assert set(table["values"].keys()) == {"component_a", "component_b"}
    assert pytest.approx(table["values"]["component_a"]["component_a"], rel=1e-6) == 1.0
    assert table["values"]["component_a"]["component_b"] == pytest.approx(
        table["values"]["component_b"]["component_a"],
    )
    assert "component_c" not in table["values"]


def test_summarize_distributions_handles_empty_and_quantiles() -> None:
    frame = pd.DataFrame(
        {
            "metric": [1, 2, 3, 4, 5],
            "sparse": [float("nan"), float("nan"), 10.0, float("nan"), float("nan")],
            "category": ["a"] * 5,
        }
    )

    summaries = summarize_distributions(frame, metrics=["metric", "sparse"], quantiles=[0.0, 0.5, 1.0])

    metric_summary = summaries["metric"]
    assert metric_summary["count"] == 5
    assert metric_summary["missing"] == 0
    assert metric_summary["mean"] == pytest.approx(3.0)
    assert metric_summary["variance"] == pytest.approx(2.0)
    assert metric_summary["quantiles"][0.0] == pytest.approx(1.0)
    assert metric_summary["quantiles"][0.5] == pytest.approx(3.0)
    assert metric_summary["quantiles"][1.0] == pytest.approx(5.0)

    sparse_summary = summaries["sparse"]
    assert sparse_summary["count"] == 1
    assert sparse_summary["missing"] == 4
    assert sparse_summary["mean"] == pytest.approx(10.0)
    assert sparse_summary["variance"] == pytest.approx(0.0)
    for q_value in sparse_summary["quantiles"].values():
        assert q_value == pytest.approx(10.0)


def test_generate_qa_signals_flags_high_leverage_and_outliers() -> None:
    frame = pd.DataFrame(
        {
            "score": [1.0, 1.5, 1.2, 10.0],
            "anchor": ["A", "A", "B", "C"],
            "weight": [5.0, 5.0, 4.0, 40.0],
        }
    )

    signals = generate_qa_signals(
        frame,
        score_column="score",
        anchor_column="anchor",
        weight_column="weight",
        leverage_threshold=0.3,
        outlier_sigma=1.5,
    )

    assert signals["warnings"] == []
    assert [signal["anchor"] for signal in signals["high_leverage_anchors"]] == ["C"]
    assert signals["high_leverage_anchors"][0]["share"] == pytest.approx(40.0 / 54.0)
    assert len(signals["outlier_scores"]) == 1
    assert signals["outlier_scores"][0]["index"] == "3"
    assert signals["outlier_scores"][0]["score"] == pytest.approx(10.0)
    assert signals["outlier_scores"][0]["z_score"] > 0


def test_generate_qa_signals_warns_when_no_scores() -> None:
    frame = pd.DataFrame(
        {
            "score": [float("nan"), float("nan")],
            "anchor": ["X", "Y"],
        }
    )

    signals = generate_qa_signals(
        frame,
        score_column="score",
        anchor_column="anchor",
        leverage_threshold=0.75,
    )

    assert not signals["high_leverage_anchors"]
    assert not signals["outlier_scores"]
    assert "No non-null scores" in signals["warnings"][0]
