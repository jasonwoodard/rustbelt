"""Utility to regenerate synthetic fixture datasets used in tests."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import pandas as pd

from atlas.clustering.anchors import (
    AnchorDetectionParameters,
    AnchorDetectionResult,
    detect_anchors,
)
from atlas.clustering.subclusters import (
    SubClusterNodeSpec,
    build_subcluster_hierarchy,
)


@dataclass(frozen=True)
class FixtureDefinition:
    """Container describing the CSV payloads for a synthetic fixture."""

    name: str
    stores: Iterable[dict[str, object]]
    affluence: Iterable[dict[str, object]] | None = None
    observations: Iterable[dict[str, object]] | None = None
    anchor_parameters: AnchorDetectionParameters | Mapping[str, object] | None = None
    subcluster_specs: Mapping[str, Sequence[SubClusterNodeSpec]] | None = None


_FIXTURES: tuple[FixtureDefinition, ...] = (
    FixtureDefinition(
        name="dense_urban",
        stores=[
            {
                "StoreId": "DU-001",
                "Name": "River Town Thrift",
                "Type": "Thrift",
                "Lat": 42.331,
                "Lon": -83.045,
                "GeoId": "G26163",
                "Metro": "Metro-Dense",
                "MedianIncomeNorm": 0.75,
                "Pct100kHHNorm": 0.65,
                "PctRenterNorm": 0.40,
            },
            {
                "StoreId": "DU-002",
                "Name": "Midtown Vintage",
                "Type": "Vintage",
                "Lat": 42.36,
                "Lon": -83.065,
                "GeoId": "G26163",
                "Metro": "Metro-Dense",
                "MedianIncomeNorm": 0.88,
                "Pct100kHHNorm": 0.72,
                "PctRenterNorm": 0.55,
            },
            {
                "StoreId": "DU-003",
                "Name": "Upcycle Collective",
                "Type": "Antique",
                "Lat": 42.347,
                "Lon": -83.052,
                "GeoId": "G26163",
                "Metro": "Metro-Dense",
                "MedianIncomeNorm": 0.92,
                "Pct100kHHNorm": 0.80,
                "PctRenterNorm": 0.35,
            },
            {
                "StoreId": "DU-004",
                "Name": "Eastern Flea",
                "Type": "Flea/Surplus",
                "Lat": 42.371,
                "Lon": -83.03,
                "GeoId": "G26165",
                "Metro": "Metro-Dense",
                "MedianIncomeNorm": 0.70,
                "Pct100kHHNorm": 0.55,
                "PctRenterNorm": 0.60,
            },
            {
                "StoreId": "DU-005",
                "Name": "Warehouse Finds",
                "Type": "Thrift",
                "Lat": 42.389,
                "Lon": -83.02,
                "GeoId": "G26165",
                "Metro": "Metro-Dense",
                "MedianIncomeNorm": 0.62,
                "Pct100kHHNorm": 0.48,
                "PctRenterNorm": 0.45,
            },
        ],
        affluence=[
            {
                "GeoId": "G26163",
                "MedianIncome": 72_000,
                "Pct100kHH": 0.32,
                "Education": 0.45,
                "HomeValue": 215_000,
                "Turnover": 0.48,
                "Metro": "Metro-Dense",
                "County": "Wayne",
            },
            {
                "GeoId": "G26165",
                "MedianIncome": 63_000,
                "Pct100kHH": 0.24,
                "Education": 0.38,
                "HomeValue": 189_000,
                "Turnover": 0.52,
                "Metro": "Metro-Dense",
                "County": "Macomb",
            },
        ],
        observations=[
            {
                "StoreId": "DU-001",
                "DateTime": "2024-02-01T11:05:00",
                "DwellMin": 48,
                "PurchasedItems": 5,
                "HaulLikert": 4.6,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-001",
                "DateTime": "2024-02-08T12:10:00",
                "DwellMin": 44,
                "PurchasedItems": 4,
                "HaulLikert": 4.4,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-002",
                "DateTime": "2024-02-03T13:40:00",
                "DwellMin": 52,
                "PurchasedItems": 6,
                "HaulLikert": 4.8,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-002",
                "DateTime": "2024-02-10T15:05:00",
                "DwellMin": 50,
                "PurchasedItems": 5,
                "HaulLikert": 4.7,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-003",
                "DateTime": "2024-02-04T10:20:00",
                "DwellMin": 41,
                "PurchasedItems": 3,
                "HaulLikert": 4.2,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-003",
                "DateTime": "2024-02-11T11:45:00",
                "DwellMin": 39,
                "PurchasedItems": 3,
                "HaulLikert": 4.1,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-004",
                "DateTime": "2024-02-06T09:55:00",
                "DwellMin": 36,
                "PurchasedItems": 4,
                "HaulLikert": 3.9,
                "Metro": "Metro-Dense",
            },
            {
                "StoreId": "DU-005",
                "DateTime": "2024-02-07T14:30:00",
                "DwellMin": 32,
                "PurchasedItems": 3,
                "HaulLikert": 3.8,
                "Metro": "Metro-Dense",
            },
        ],
        anchor_parameters=AnchorDetectionParameters(
            algorithm="dbscan",
            eps=0.03,
            min_samples=2,
            metric="euclidean",
            id_prefix="dense-anchor",
        ),
        subcluster_specs={
            "dense-anchor-001": (
                SubClusterNodeSpec(
                    key="dense-core",
                    store_ids=("DU-001", "DU-002", "DU-003"),
                    metadata={"tier": "core"},
                ),
                SubClusterNodeSpec(
                    key="dense-riverfront",
                    parent_key="dense-core",
                    store_ids=("DU-001", "DU-002"),
                    metadata={"segment": "riverfront"},
                ),
                SubClusterNodeSpec(
                    key="dense-midtown",
                    parent_key="dense-core",
                    store_ids=("DU-003",),
                    metadata={"segment": "midtown"},
                ),
            ),
            "dense-anchor-002": (
                SubClusterNodeSpec(
                    key="dense-east",
                    store_ids=("DU-004", "DU-005"),
                    metadata={"tier": "secondary"},
                ),
                SubClusterNodeSpec(
                    key="dense-eastern-market",
                    parent_key="dense-east",
                    store_ids=("DU-004",),
                ),
                SubClusterNodeSpec(
                    key="dense-north-channel",
                    parent_key="dense-east",
                    store_ids=("DU-005",),
                ),
            ),
        },
    ),
    FixtureDefinition(
        name="sparse_rural",
        stores=[
            {
                "StoreId": "SR-001",
                "Name": "Country Exchange",
                "Type": "Thrift",
                "Lat": 41.801,
                "Lon": -84.124,
                "GeoId": "G26001",
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-002",
                "Name": "Depot Vintage",
                "Type": "Vintage",
                "Lat": 41.923,
                "Lon": -84.256,
                "GeoId": "G26005",
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-003",
                "Name": "Old Barn Finds",
                "Type": "Flea/Surplus",
                "Lat": 42.015,
                "Lon": -84.392,
                "GeoId": "G26009",
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-004",
                "Name": "Hearthside Antiques",
                "Type": "Antique",
                "Lat": 42.087,
                "Lon": -84.511,
                "GeoId": "G26011",
                "Metro": "Metro-Rural",
            },
        ],
        affluence=[
            {
                "GeoId": "G26001",
                "MedianIncome": 54_000,
                "Pct100kHH": 0.18,
                "Education": 0.31,
                "HomeValue": 162_000,
                "Turnover": 0.27,
                "Metro": "Metro-Rural",
                "County": "Hillsdale",
            },
            {
                "GeoId": "G26005",
                "MedianIncome": 51_000,
                "Pct100kHH": 0.16,
                "Education": 0.29,
                "HomeValue": 154_000,
                "Turnover": 0.25,
                "Metro": "Metro-Rural",
                "County": "Jackson",
            },
            {
                "GeoId": "G26009",
                "MedianIncome": 47_000,
                "Pct100kHH": 0.12,
                "Education": 0.26,
                "HomeValue": 143_000,
                "Turnover": 0.23,
                "Metro": "Metro-Rural",
                "County": "Lenawee",
            },
            {
                "GeoId": "G26011",
                "MedianIncome": 59_000,
                "Pct100kHH": 0.20,
                "Education": 0.34,
                "HomeValue": 171_000,
                "Turnover": 0.21,
                "Metro": "Metro-Rural",
                "County": "Monroe",
            },
        ],
        observations=[
            {
                "StoreId": "SR-001",
                "DateTime": "2024-01-12T10:15:00",
                "DwellMin": 38,
                "PurchasedItems": 3,
                "HaulLikert": 3.9,
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-001",
                "DateTime": "2024-02-16T14:25:00",
                "DwellMin": 34,
                "PurchasedItems": 2,
                "HaulLikert": 3.7,
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-002",
                "DateTime": "2024-02-02T09:45:00",
                "DwellMin": 30,
                "PurchasedItems": 2,
                "HaulLikert": 3.8,
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-003",
                "DateTime": "2024-01-26T13:35:00",
                "DwellMin": 28,
                "PurchasedItems": 2,
                "HaulLikert": 3.5,
                "Metro": "Metro-Rural",
            },
            {
                "StoreId": "SR-004",
                "DateTime": "2024-02-20T11:10:00",
                "DwellMin": 26,
                "PurchasedItems": 1,
                "HaulLikert": 3.6,
                "Metro": "Metro-Rural",
            },
        ],
        anchor_parameters=AnchorDetectionParameters(
            algorithm="dbscan",
            eps=20.0,
            min_samples=2,
            metric="haversine",
            id_prefix="rural-anchor",
        ),
        subcluster_specs={
            "rural-anchor-001": (
                SubClusterNodeSpec(
                    key="rural-network",
                    store_ids=("SR-001", "SR-002", "SR-003", "SR-004"),
                    metadata={"tier": "regional"},
                ),
                SubClusterNodeSpec(
                    key="rural-north",
                    parent_key="rural-network",
                    store_ids=("SR-001", "SR-002"),
                ),
                SubClusterNodeSpec(
                    key="rural-south",
                    parent_key="rural-network",
                    store_ids=("SR-003", "SR-004"),
                ),
                SubClusterNodeSpec(
                    key="rural-lakeside",
                    parent_key="rural-south",
                    store_ids=("SR-004",),
                ),
            ),
        },
    ),
)


def _write_csv(records: Iterable[dict[str, object]] | None, path: Path) -> None:
    if records is None:
        return
    frame = pd.DataFrame.from_records(list(records))
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)


def _write_frame(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)


def _write_json(data: Mapping[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, sort_keys=True) + "\n"
    path.write_text(payload, encoding="utf-8")


def _coerce_anchor_parameters(
    params: AnchorDetectionParameters | Mapping[str, object] | None,
) -> AnchorDetectionParameters | None:
    if params is None:
        return None
    if isinstance(params, AnchorDetectionParameters):
        return params
    if isinstance(params, Mapping):
        return AnchorDetectionParameters(**params)
    raise TypeError("Unsupported anchor parameter configuration")


def regenerate(root: str | Path | None = None) -> None:
    """Regenerate all fixture CSVs under ``root`` (defaults to package data)."""

    base = Path(root) if root is not None else Path(__file__).resolve().parent
    for fixture in _FIXTURES:
        target = base / fixture.name
        stores = list(fixture.stores)
        _write_csv(stores, target / "stores.csv")
        _write_csv(fixture.affluence, target / "affluence.csv")
        _write_csv(fixture.observations, target / "observations.csv")

        anchor_params = _coerce_anchor_parameters(fixture.anchor_parameters)
        anchor_result: AnchorDetectionResult | None = None

        if anchor_params is not None:
            stores_frame = pd.DataFrame.from_records(stores)
            anchor_result = detect_anchors(stores_frame, anchor_params)
            anchors_frame = anchor_result.to_frame()
            if "store_ids" in anchors_frame.columns:
                anchors_frame["store_ids"] = anchors_frame["store_ids"].apply(
                    lambda value: json.dumps(list(value))
                )
            anchors_path = target / "anchors.csv"
            _write_frame(anchors_frame, anchors_path)

            assignments = anchor_result.store_assignments.reset_index()
            assignments.columns = [
                anchor_params.store_id_column,
                "anchor_id",
            ]
            _write_frame(assignments, target / "anchor_assignments.csv")
            _write_json(anchor_result.metrics, target / "anchor_metrics.json")

        subcluster_specs = fixture.subcluster_specs or {}
        if subcluster_specs:
            if anchor_result is None:
                raise RuntimeError(
                    "Sub-cluster specifications require anchor detection results"
                )
            all_subclusters: list[dict[str, object]] = []
            for anchor in anchor_result.anchors:
                specs = subcluster_specs.get(anchor.anchor_id)
                if not specs:
                    continue
                hierarchy = build_subcluster_hierarchy(anchor.anchor_id, specs)
                all_subclusters.extend(hierarchy.to_records())

            if all_subclusters:
                subclusters_frame = pd.DataFrame.from_records(all_subclusters)
                if "store_ids" in subclusters_frame.columns:
                    subclusters_frame["store_ids"] = subclusters_frame["store_ids"].apply(
                        lambda value: json.dumps(list(value))
                    )
                if "metadata" in subclusters_frame.columns:
                    subclusters_frame["metadata"] = subclusters_frame["metadata"].apply(
                        lambda value: json.dumps(dict(value))
                    )
                _write_frame(subclusters_frame, target / "subclusters.csv")


if __name__ == "__main__":  # pragma: no cover - manual utility
    regenerate()
