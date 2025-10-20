"""Tests for the posterior scoring pipeline."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from atlas.scoring import PosteriorPipeline


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

