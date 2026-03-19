"""Tests for the posterior scoring pipeline."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from atlas.scoring import PosteriorPipeline
from atlas.scoring.posterior import _haversine_distances, _knn_smooth_sparse_predictions


def _make_store_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "StoreId": ["A", "B", "C", "D"],
            "Latitude": [42.0, 42.1, 42.2, 42.3],
            "Longitude": [-83.0, -83.1, -83.2, -83.3],
            "MedianIncome": [55_000, 57_000, 60_000, 58_000],
            "Pct100kHH": [0.20, 0.22, 0.25, 0.30],
            "Metro": ["Metro-1", "Metro-1", "Metro-1", "Metro-1"],
        }
    )


def _make_observations_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "StoreId": [
                "A",
                "A",
                "A",
                "B",
                "B",
                "C",
            ],
            "DateTime": [
                "2024-03-01T10:00:00",
                "2024-03-05T11:00:00",
                "2024-03-08T14:30:00",
                "2024-03-02T09:45:00",
                "2024-03-04T10:15:00",
                "2024-03-06T13:00:00",
            ],
            "DwellMin": [45.0, 60.0, 30.0, 45.0, 50.0, 40.0],
            "PurchasedItems": [3, 4, 2, 5, 4, 1],
            "HaulLikert": [4.0, 5.0, 4.0, 3.0, 3.0, 2.0],
            "Metro": ["Metro-1"] * 6,
        }
    )


def test_posterior_pipeline_recovers_observed_scores(tmp_path: Path) -> None:
    stores = _make_store_frame()
    observations = _make_observations_frame()

    pipeline = PosteriorPipeline(min_samples_glm=3, shrinkage_strength=2.0, knn_k=2, knn_smoothing_factor=0.6)
    cache_path = tmp_path / "ecdf-reference.parquet"
    pipeline.fit(
        observations,
        stores,
        feature_columns=["MedianIncome", "Pct100kHH"],
        window_column="Metro",
        ecdf_cache_path=cache_path,
    )

    assert cache_path.exists()
    cached = pd.read_parquet(cache_path)
    assert not cached.empty
    assert {"Window", "Theta", "Quantile"}.issubset(cached.columns)

    predictions = pipeline.predict(stores)

    assert set(predictions.columns) == {"StoreId", "Theta", "Yield", "Value", "Cred", "Method", "ECDF_q"}
    assert (predictions["Cred"] > 0.0).all()
    assert (predictions["Yield"].between(1.0, 5.0)).all()

    traces = pipeline.trace_records_
    assert traces is not None
    assert set(traces.keys()) == set(predictions["StoreId"])
    for store_id, trace in traces.items():
        trace_row = trace.to_dict()
        assert trace_row["scores.theta_final"] == pytest.approx(
            predictions.loc[predictions["StoreId"] == store_id, "Theta"].iloc[0]
        )
        assert "baseline.theta_prediction" in trace_row
        assert "observations.visits" in trace_row
        assert "model.parameters_hash" in trace_row

    trace_rows = list(pipeline.iter_traces())
    assert trace_rows
    assert {row["store_id"] for row in trace_rows} == set(predictions["StoreId"])
    assert all(row["stage"] == "posterior" for row in trace_rows)
    first_trace = trace_rows[0]
    assert {"baseline.theta_prediction", "observations.visits", "scores.yield_final"} <= set(first_trace)

    trace_frame = pipeline.trace_records_frame()
    assert not trace_frame.empty
    assert set(trace_frame["store_id"]) == set(predictions["StoreId"])
    assert {"baseline.theta_prediction", "scores.theta_final"} <= set(trace_frame.columns)

    summary = pipeline.store_summary_
    assert summary is not None

    visited = predictions[predictions["StoreId"].isin(summary.index)]
    for _, row in visited.iterrows():
        store_id = row["StoreId"]
        observed_theta = summary.loc[store_id, "theta_mean"]
        observed_value = summary.loc[store_id, "value_mean"]
        assert np.isclose(row["Theta"], observed_theta, atol=0.6)
        assert np.isclose(row["Value"], observed_value, atol=0.75)

    methods = dict(zip(predictions["StoreId"], predictions["Method"]))
    assert methods["A"] == "GLM"
    assert methods["B"] == "Hier"
    assert methods["C"] == "Hier"
    assert methods["D"] in {"kNN", "Hier"}

    unvisited = predictions[predictions["StoreId"] == "D"].iloc[0]
    assert unvisited["Cred"] > 0.0
    assert unvisited["Method"] in {"kNN", "Hier"}


def test_ecdf_quantile_is_reused_between_runs(tmp_path: Path) -> None:
    stores = _make_store_frame()
    observations = _make_observations_frame()

    cache_path = tmp_path / "ecdf-reference.parquet"

    pipeline = PosteriorPipeline()
    pipeline.fit(
        observations,
        stores,
        window_column="Metro",
        ecdf_cache_path=cache_path,
    )

    original_reference = pipeline.ecdf_reference_
    assert original_reference is not None
    reloaded_reference = pd.read_parquet(cache_path)
    pd.testing.assert_frame_equal(original_reference, reloaded_reference)

    predictions = pipeline.predict(stores)
    order = np.argsort(predictions["Theta"].to_numpy())
    sorted_quantiles = predictions.iloc[order]["ECDF_q"].to_numpy()
    assert np.all(sorted_quantiles[:-1] <= sorted_quantiles[1:] + 1e-8)


# ---------------------------------------------------------------------------
# Haversine distance tests (Issue 3 / Tier 2.1)
# ---------------------------------------------------------------------------


def test_haversine_distances_known_values() -> None:
    """Haversine distances match known city-pair values within 5 km."""
    # Detroit (42.33, -83.05) → Cleveland (41.50, -81.69): ~146 km as the crow flies
    detroit = np.array([[42.33, -83.05]])
    cleveland = np.array([41.50, -81.69])
    dist = _haversine_distances(detroit, cleveland)
    assert dist.shape == (1,)
    assert abs(dist[0] - 146.0) < 5.0  # within 5 km of straight-line distance

    # Detroit → Pittsburgh (40.44, -79.99): ~331 km as the crow flies
    pittsburgh = np.array([40.44, -79.99])
    dist2 = _haversine_distances(detroit, pittsburgh)
    assert abs(dist2[0] - 331.0) < 10.0

    # Same point → 0
    zero = _haversine_distances(detroit, detroit[0])
    assert abs(zero[0]) < 0.01


def test_haversine_distances_east_west_vs_north_south() -> None:
    """Haversine corrects the Euclidean degree-distortion.

    At ~42° N latitude, 1° of longitude ≈ 82 km and 1° of latitude ≈ 111 km.
    A point displaced 1° east is closer than a point displaced 1° north, but
    Euclidean distance on raw degrees treats them as equal.

    Haversine must report the east-displaced point as closer.
    """
    origin = np.array([[42.0, -83.0]])
    north_1deg = np.array([43.0, -83.0])  # 1° N  ≈ 111 km
    east_1deg = np.array([42.0, -82.0])   # 1° E  ≈  82 km at 42° N

    dist_north = _haversine_distances(origin, north_1deg)[0]
    dist_east = _haversine_distances(origin, east_1deg)[0]

    # Haversine knows east-displacement is shorter at this latitude
    assert dist_east < dist_north, (
        f"Expected east-displacement ({dist_east:.1f} km) < north-displacement "
        f"({dist_north:.1f} km) at 42° N — Euclidean on degrees would call them equal"
    )

    # Rough magnitude check: 1° lon at 42° N ≈ 82 km, 1° lat ≈ 111 km
    assert 75 < dist_east < 90
    assert 108 < dist_north < 114


def test_knn_smooth_uses_haversine_neighbor_selection() -> None:
    """kNN smoother weights by km, not by degree-distance.

    Geometry at ~42° N latitude:
      - 1° of latitude  ≈ 111 km (north-south)
      - 1° of longitude ≈  82 km (east-west, shrinks with cos(lat))

    Anchor A is 1° west  of sparse store D  → ~82 km  (closer in km)
    Anchor B is 1° north of sparse store D  → ~111 km (farther in km)

    With Euclidean distance on raw degrees both anchors are exactly 1° away,
    so the weights are equal and the smoothed value is 5.5 (midpoint of 1 and 10).

    With Haversine, A is meaningfully closer → its weight is larger → the
    smoothed value is pulled above 5.5 toward A's theta of 10.
    """
    # Sparse store D at 42° N, −83° E
    # Anchor A: 1° west  — same latitude, closer in km
    # Anchor B: 1° north — same longitude, farther in km
    stores = pd.DataFrame(
        {
            "StoreId": ["A", "B", "D"],
            "Latitude": [42.0, 43.0, 42.0],
            "Longitude": [-84.0, -83.0, -83.0],
        }
    )

    theta = np.array([10.0, 1.0, 0.0])
    value = np.array([5.0, 1.0, 0.0])
    visits = np.array([1, 1, 0])  # D is sparse

    smoothed_theta, _ = _knn_smooth_sparse_predictions(
        stores, theta, value, visits, k=2, smoothing_factor=1.0
    )

    smoothed_d = smoothed_theta[2]

    # Euclidean on degrees: equal weights → result = 5.5 exactly
    # Haversine: A is closer (~82 km vs ~111 km) → result > 5.5
    assert smoothed_d > 5.5, (
        f"With Haversine, west-displaced anchor A (~82 km) should outweigh "
        f"north-displaced anchor B (~111 km); expected > 5.5, got {smoothed_d:.4f}"
    )
    # Sanity bounds: should be between 5.5 and 10.0
    assert smoothed_d < 10.0


def test_knn_smooth_cross_metro_prefers_nearer_city() -> None:
    """Across metros, kNN smoother selects the geographically nearest anchor.

    Scenario: sparse store in Pittsburgh (40.44, -79.99).
    Two anchors:
      - Detroit  (42.33, -83.05): ~355 km
      - Philadelphia (39.95, -75.16): ~490 km
    With k=1 and smoothing_factor=1.0 the sparse store should be 100%
    smoothed toward Detroit (the closer city), not Philadelphia.

    Euclidean on raw degrees would give:
      Detroit:      sqrt((2.11)^2 + (3.06)^2) ≈ 3.72°
      Philadelphia: sqrt((0.49)^2 + (4.83)^2) ≈ 4.86°
    So Euclidean also picks Detroit here — but the margin is realistic.
    The haversine distances are roughly:
      Detroit ≈ 355 km, Philadelphia ≈ 490 km
    This test documents the expected cross-metro behaviour.
    """
    stores = pd.DataFrame(
        {
            "StoreId": ["Detroit", "Philly", "Pittsburgh"],
            "Latitude": [42.33, 39.95, 40.44],
            "Longitude": [-83.05, -75.16, -79.99],
        }
    )

    theta = np.array([8.0, 2.0, 0.0])
    value = np.array([4.0, 2.0, 0.0])
    visits = np.array([5, 5, 0])

    smoothed_theta, _ = _knn_smooth_sparse_predictions(
        stores, theta, value, visits, k=1, smoothing_factor=1.0
    )

    # Pittsburgh should be smoothed 100% toward Detroit (closer), not Philly
    assert smoothed_theta[2] == pytest.approx(8.0, abs=0.01), (
        f"Pittsburgh theta should match Detroit's (8.0) with k=1; got {smoothed_theta[2]:.3f}"
    )
