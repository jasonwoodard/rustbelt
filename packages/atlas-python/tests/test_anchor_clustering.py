import pandas as pd
import pytest

from atlas.clustering import (
    AnchorClusteringError,
    AnchorDetectionParameters,
    detect_anchors,
)


def test_detect_anchors_dbscan_clusters():
    stores = pd.DataFrame(
        {
            "StoreId": ["s1", "s2", "s3", "s4", "s5"],
            "Lat": [0.0, 0.01, 0.5, 0.51, 1.5],
            "Lon": [0.0, 0.01, 0.5, 0.52, 1.5],
        }
    )

    params = AnchorDetectionParameters(
        algorithm="dbscan",
        eps=0.05,
        min_samples=2,
        metric="euclidean",
        id_prefix="metro-anchor",
    )

    result = detect_anchors(stores, params)

    assert result.metrics["num_anchors"] == 2
    assert result.metrics["noise_points"] == 1
    assert result.metrics["noise_ratio"] == pytest.approx(1 / 5)

    anchor_ids = [anchor.anchor_id for anchor in result.anchors]
    assert anchor_ids == ["metro-anchor-001", "metro-anchor-002"]

    counts = [anchor.store_count for anchor in result.anchors]
    assert counts == [2, 2]

    assignments = result.store_assignments.dropna()
    assert set(assignments.index) == {"s1", "s2", "s3", "s4"}
    assert set(assignments.values) == set(anchor_ids)
    assert result.store_assignments.loc["s5"] is None


def test_detect_anchors_haversine_metric():
    stores = pd.DataFrame(
        {
            "StoreId": ["c1", "c2", "c3", "c4"],
            "Lat": [41.8781, 41.8810, 41.8789, 42.05],
            "Lon": [-87.6298, -87.6270, -87.6305, -87.90],
        }
    )

    params = AnchorDetectionParameters(
        algorithm="dbscan",
        eps=2.0,  # kilometers
        min_samples=2,
        metric="haversine",
        id_prefix="chi-anchor",
        metro_id="chi",
    )

    result = detect_anchors(stores, params)

    assert result.metrics["num_anchors"] == 1
    assert result.anchors[0].store_count == 3
    assert set(result.anchors[0].store_ids) == {"c1", "c2", "c3"}
    assert result.metrics["noise_points"] == 1
    assert result.metrics["metro_id"] == "chi"


def test_detect_anchors_missing_columns():
    stores = pd.DataFrame({"StoreId": ["s1"]})

    with pytest.raises(AnchorClusteringError):
        detect_anchors(stores)


def test_detect_anchors_empty_frame():
    stores = pd.DataFrame(columns=["StoreId", "Lat", "Lon"])  # Empty dataset

    params = AnchorDetectionParameters(eps=0.1, min_samples=2, metric="euclidean")
    result = detect_anchors(stores, params)

    assert result.anchors == ()
    assert result.metrics["total_points"] == 0
    assert result.metrics["num_anchors"] == 0
    assert result.metrics["noise_points"] == 0
    assert result.store_assignments.empty
