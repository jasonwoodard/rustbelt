"""Tests for the prior scoring module."""

from __future__ import annotations

import math

import pandas as pd

from atlas.scoring import (
    clamp_score,
    compute_prior_score,
    get_affluence_coefficients,
    get_type_baseline,
    knn_adjacency_smoothing,
)


def test_type_baseline_lookup_defaults_to_unknown() -> None:
    baseline = get_type_baseline("Unknown")
    assert math.isclose(baseline.value, 3.0)
    assert math.isclose(baseline.yield_score, 3.0)

    fallback = get_type_baseline("Nonexistent")
    assert fallback == baseline


def test_affluence_coefficients_lookup_defaults_to_unknown() -> None:
    coeffs = get_affluence_coefficients("Thrift")
    assert math.isclose(coeffs.alpha_income, 0.5)
    assert math.isclose(coeffs.beta_renter, -0.5)

    fallback = get_affluence_coefficients("Nonexistent")
    unknown = get_affluence_coefficients("Unknown")
    assert fallback == unknown


def test_compute_prior_score_matches_spec_example() -> None:
    result = compute_prior_score(
        "Thrift",
        median_income_norm=0.95,
        pct_hh_100k_norm=0.90,
        pct_renter_norm=0.20,
        lambda_weight=0.6,
    )

    assert math.isclose(result.value, 3.725, rel_tol=1e-6)
    assert math.isclose(result.yield_score, 3.30, rel_tol=1e-6)
    assert math.isclose(result.composite or 0.0, 3.555, rel_tol=1e-6)

    assert math.isclose(result.baseline_value, 2.8, rel_tol=1e-6)
    assert math.isclose(result.income_contribution, 0.475, rel_tol=1e-6)
    assert math.isclose(result.high_income_contribution, 0.45, rel_tol=1e-6)
    assert math.isclose(result.renter_contribution, -0.1, rel_tol=1e-6)


def test_compute_prior_score_clamps_outputs() -> None:
    result = compute_prior_score(
        "Vintage",
        median_income_norm=10.0,
        pct_hh_100k_norm=10.0,
        pct_renter_norm=-10.0,
        lambda_weight=0.6,
    )

    assert result.value == 5.0
    assert result.yield_score == 5.0
    assert result.composite == 5.0


def test_compute_prior_score_with_adjacency_adjustment() -> None:
    result = compute_prior_score(
        "Thrift",
        median_income_norm=0.2,
        pct_hh_100k_norm=0.2,
        pct_renter_norm=0.2,
        adjacency_adjustment=(0.1, -0.2),
    )

    assert math.isclose(result.value, clamp_score(2.8 + 0.1 + 0.1 + 0.1), rel_tol=1e-6)
    assert math.isclose(result.yield_score, clamp_score(3.4 - 0.1 - 0.2), rel_tol=1e-6)
    assert math.isclose(result.adjacency_value_adjustment, 0.1, rel_tol=1e-6)
    assert math.isclose(result.adjacency_yield_adjustment, -0.2, rel_tol=1e-6)


def test_knn_adjacency_smoothing_blends_neighbours() -> None:
    frame = pd.DataFrame(
        {
            "Latitude": [0.0, 0.0, 1.0],
            "Longitude": [0.0, 1.0, 0.0],
            "Value": [3.0, 4.0, 5.0],
            "Yield": [3.0, 2.0, 4.0],
        }
    )

    smoothed = knn_adjacency_smoothing(frame, k=2, smoothing_factor=0.5)

    assert "value_smoothed" in smoothed
    assert "yield_smoothed" in smoothed
    # Ensure the first point moved towards its neighbours.
    assert smoothed.loc[0, "value_smoothed"] > frame.loc[0, "Value"]
    # Yield may remain unchanged if neighbours balance perfectly.
    assert not math.isclose(smoothed.loc[0, "value_adjustment"], 0.0)


def test_knn_adjacency_smoothing_handles_small_sample() -> None:
    frame = pd.DataFrame(
        {
            "Latitude": [42.0],
            "Longitude": [-83.0],
            "Value": [3.2],
            "Yield": [3.3],
        }
    )

    smoothed = knn_adjacency_smoothing(frame, k=3, smoothing_factor=0.5)
    assert smoothed.loc[0, "value_adjustment"] == 0.0
    assert smoothed.loc[0, "yield_adjustment"] == 0.0


def test_prior_score_result_trace_contains_expected_keys() -> None:
    result = compute_prior_score("Thrift")
    trace = result.to_trace()

    assert trace["value"] == result.value
    assert "baseline_value" in trace
    assert "posterior_value_override" in trace
