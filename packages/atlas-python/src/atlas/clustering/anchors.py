"""Anchor detection utilities for Atlas metro clustering."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Literal, Tuple

import numpy as np
import pandas as pd


AlgorithmName = Literal["dbscan", "hdbscan"]
DistanceMetric = Literal["euclidean", "manhattan", "haversine"]


class AnchorClusteringError(RuntimeError):
    """Raised when anchor clustering cannot be performed."""


@dataclass(slots=True)
class AnchorDetectionParameters:
    """Configuration for anchor detection using density-based clustering."""

    algorithm: AlgorithmName = "dbscan"
    eps: float = 0.5
    min_samples: int = 5
    metric: DistanceMetric = "haversine"
    min_cluster_size: int | None = None
    cluster_selection_epsilon: float | None = None
    store_id_column: str = "StoreId"
    lat_column: str = "Lat"
    lon_column: str = "Lon"
    metro_id: str | None = None
    id_prefix: str | None = None

    def resolve_prefix(self) -> str:
        if self.id_prefix is not None:
            return self.id_prefix
        if self.metro_id:
            return f"{self.metro_id}-anchor"
        return "anchor"


@dataclass(slots=True)
class Anchor:
    """Represents a derived Atlas anchor cluster."""

    anchor_id: str
    cluster_label: int
    centroid_lat: float
    centroid_lon: float
    store_count: int
    store_ids: Tuple[str, ...]


@dataclass(slots=True)
class AnchorDetectionResult:
    """Structured result for anchor detection."""

    anchors: Tuple[Anchor, ...]
    store_assignments: pd.Series
    metrics: Dict[str, float | int | str]

    def to_frame(self) -> pd.DataFrame:
        """Return anchor metadata as a dataframe."""

        if not self.anchors:
            return pd.DataFrame(
                columns=[
                    "anchor_id",
                    "cluster_label",
                    "centroid_lat",
                    "centroid_lon",
                    "store_count",
                    "store_ids",
                ]
            )

        return pd.DataFrame(
            {
                "anchor_id": [anchor.anchor_id for anchor in self.anchors],
                "cluster_label": [anchor.cluster_label for anchor in self.anchors],
                "centroid_lat": [anchor.centroid_lat for anchor in self.anchors],
                "centroid_lon": [anchor.centroid_lon for anchor in self.anchors],
                "store_count": [anchor.store_count for anchor in self.anchors],
                "store_ids": [anchor.store_ids for anchor in self.anchors],
            }
        )


EARTH_RADIUS_KM = 6371.0


def detect_anchors(
    stores: pd.DataFrame,
    params: AnchorDetectionParameters | None = None,
) -> AnchorDetectionResult:
    """Cluster stores into metro anchors using DBSCAN/HDBSCAN."""

    params = params or AnchorDetectionParameters()

    required_columns = {
        params.store_id_column,
        params.lat_column,
        params.lon_column,
    }
    missing = required_columns - set(stores.columns)
    if missing:
        raise AnchorClusteringError(
            "stores dataframe is missing required columns: " + ", ".join(sorted(missing))
        )

    if stores.empty:
        empty_assignments = pd.Series(
            dtype="object",
            name="anchor_id",
            index=pd.Index([], name=params.store_id_column),
        )
        metrics: Dict[str, float | int | str] = {
            "algorithm": params.algorithm,
            "metric": params.metric,
            "total_points": 0,
            "num_anchors": 0,
            "noise_points": 0,
            "noise_ratio": 0.0,
        }
        if params.algorithm == "dbscan":
            metrics.update({"eps": params.eps, "min_samples": params.min_samples})
        elif params.algorithm == "hdbscan":
            metrics.update({"min_samples": params.min_samples})
            if params.min_cluster_size is not None:
                metrics["min_cluster_size"] = params.min_cluster_size
            if params.cluster_selection_epsilon is not None:
                metrics["cluster_selection_epsilon"] = params.cluster_selection_epsilon
        if params.metro_id is not None:
            metrics["metro_id"] = params.metro_id
        return AnchorDetectionResult(
            anchors=tuple(),
            store_assignments=empty_assignments,
            metrics=metrics,
        )

    store_ids = stores[params.store_id_column].astype(str).to_numpy()
    coords = stores[[params.lat_column, params.lon_column]].to_numpy(dtype=float, copy=True)

    metric = params.metric
    if metric not in {"euclidean", "manhattan", "haversine"}:
        raise AnchorClusteringError(f"Unsupported distance metric '{metric}'.")

    if params.algorithm == "dbscan":
        labels = _run_dbscan(coords, eps=params.eps, min_samples=params.min_samples, metric=metric)
        algorithm_details: Dict[str, float | int | str] = {
            "algorithm": "dbscan",
            "eps": params.eps,
            "min_samples": params.min_samples,
        }
    elif params.algorithm == "hdbscan":
        labels = _run_hdbscan(
            coords,
            metric=metric,
            min_samples=params.min_samples,
            min_cluster_size=params.min_cluster_size,
            cluster_selection_epsilon=params.cluster_selection_epsilon,
        )
        algorithm_details = {
            "algorithm": "hdbscan",
            "min_samples": params.min_samples,
        }
        if params.min_cluster_size is not None:
            algorithm_details["min_cluster_size"] = params.min_cluster_size
        if params.cluster_selection_epsilon is not None:
            algorithm_details["cluster_selection_epsilon"] = params.cluster_selection_epsilon
    else:
        raise AnchorClusteringError(f"Unsupported clustering algorithm '{params.algorithm}'.")

    anchors, assignments = _build_anchor_records(
        store_ids=store_ids,
        coords=coords,
        labels=labels,
        prefix=params.resolve_prefix(),
    )

    metrics: Dict[str, float | int | str] = {
        **algorithm_details,
        "metric": metric,
        "total_points": int(len(store_ids)),
        "num_anchors": int(len(anchors)),
        "noise_points": int(np.sum(labels == -1)),
    }
    if metrics["total_points"]:
        metrics["noise_ratio"] = metrics["noise_points"] / metrics["total_points"]
    if params.metro_id is not None:
        metrics["metro_id"] = params.metro_id

    assignments_series = pd.Series(
        assignments,
        index=pd.Index(store_ids, name=params.store_id_column),
        name="anchor_id",
    )

    return AnchorDetectionResult(
        anchors=tuple(anchors),
        store_assignments=assignments_series,
        metrics=metrics,
    )


def _run_dbscan(
    coords: np.ndarray,
    *,
    eps: float,
    min_samples: int,
    metric: DistanceMetric,
) -> np.ndarray:
    if eps <= 0:
        raise AnchorClusteringError("eps must be positive for DBSCAN.")
    if min_samples < 1:
        raise AnchorClusteringError("min_samples must be at least 1 for DBSCAN.")

    n_points = coords.shape[0]
    labels = np.full(n_points, -1, dtype=int)
    visited = np.zeros(n_points, dtype=bool)
    cluster_id = 0

    for point_index in range(n_points):
        if visited[point_index]:
            continue

        visited[point_index] = True
        neighbors = _region_query(coords, point_index, eps=eps, metric=metric)
        if len(neighbors) < min_samples:
            labels[point_index] = -1
            continue

        labels[point_index] = cluster_id
        seeds_set = set(neighbors)
        seeds_set.discard(point_index)
        seeds = deque(seeds_set)

        while seeds:
            current = seeds.popleft()
            if not visited[current]:
                visited[current] = True
                current_neighbors = _region_query(coords, current, eps=eps, metric=metric)
                if len(current_neighbors) >= min_samples:
                    for neighbor in current_neighbors:
                        if neighbor not in seeds_set:
                            seeds.append(neighbor)
                            seeds_set.add(neighbor)
            if labels[current] == -1:
                labels[current] = cluster_id
        cluster_id += 1

    return labels


def _run_hdbscan(
    coords: np.ndarray,
    *,
    metric: DistanceMetric,
    min_samples: int,
    min_cluster_size: int | None,
    cluster_selection_epsilon: float | None,
) -> np.ndarray:
    try:
        import hdbscan  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise AnchorClusteringError(
            "HDBSCAN algorithm requested but 'hdbscan' package is not installed."
        ) from exc

    if min_cluster_size is None:
        min_cluster_size = max(min_samples, 2)

    fit_coords = coords
    fit_metric: str = metric
    if metric == "haversine":
        fit_coords = np.radians(coords)
        fit_metric = "haversine"

    clusterer = hdbscan.HDBSCAN(
        min_samples=min_samples,
        min_cluster_size=min_cluster_size,
        metric=fit_metric,
        cluster_selection_epsilon=cluster_selection_epsilon or 0.0,
    )
    labels = clusterer.fit_predict(fit_coords)
    return labels


def _build_anchor_records(
    *,
    store_ids: np.ndarray,
    coords: np.ndarray,
    labels: np.ndarray,
    prefix: str,
) -> Tuple[List[Anchor], List[str | None]]:
    cluster_labels = sorted(label for label in np.unique(labels) if label >= 0)
    anchors: List[Anchor] = []
    assignments: List[str | None] = []
    cluster_to_anchor: Dict[int, str] = {}

    for ordinal, cluster_label in enumerate(cluster_labels, start=1):
        member_indices = np.where(labels == cluster_label)[0]
        cluster_to_anchor[cluster_label] = f"{prefix}-{ordinal:03d}"
        member_coords = coords[member_indices]
        centroid_lat = float(member_coords[:, 0].mean())
        centroid_lon = float(member_coords[:, 1].mean())
        member_store_ids = tuple(str(store_ids[index]) for index in member_indices)
        anchors.append(
            Anchor(
                anchor_id=cluster_to_anchor[cluster_label],
                cluster_label=cluster_label,
                centroid_lat=centroid_lat,
                centroid_lon=centroid_lon,
                store_count=len(member_indices),
                store_ids=member_store_ids,
            )
        )

    for label in labels:
        anchor_id = cluster_to_anchor.get(label)
        assignments.append(anchor_id)

    return anchors, assignments


def _region_query(
    coords: np.ndarray,
    point_index: int,
    *,
    eps: float,
    metric: DistanceMetric,
) -> List[int]:
    if metric == "euclidean":
        distances = np.linalg.norm(coords - coords[point_index], axis=1)
    elif metric == "manhattan":
        distances = np.abs(coords - coords[point_index]).sum(axis=1)
    elif metric == "haversine":
        distances = _haversine_distances(coords, point_index)
    else:  # pragma: no cover - handled earlier
        raise AnchorClusteringError(f"Unsupported distance metric '{metric}'.")

    neighbors = np.where(distances <= eps)[0]
    return neighbors.tolist()


def _haversine_distances(coords: np.ndarray, point_index: int) -> np.ndarray:
    reference = np.radians(coords[point_index])
    lat1, lon1 = reference
    lat2 = np.radians(coords[:, 0])
    lon2 = np.radians(coords[:, 1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    return EARTH_RADIUS_KM * c
