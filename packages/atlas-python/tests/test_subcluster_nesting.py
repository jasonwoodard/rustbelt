import pytest

from atlas.clustering import (
    SubClusterNodeSpec,
    SubClusterTopologyError,
    build_subcluster_hierarchy,
)


def test_build_subcluster_hierarchy_assigns_stable_identifiers():
    specs = [
        SubClusterNodeSpec(key="c2", parent_key=None, store_ids=("s3", "s4")),
        SubClusterNodeSpec(key="c1", parent_key=None, store_ids=("s2", "s1")),
        SubClusterNodeSpec(key="c1a", parent_key="c1", store_ids=("s1",), metadata={"score": 0.8}),
        SubClusterNodeSpec(key="c1b", parent_key="c1", store_ids=("s2",), metadata={"score": 0.2}),
    ]

    hierarchy = build_subcluster_hierarchy("anchor-001", specs)

    identifiers = [cluster.subcluster_id for cluster in hierarchy]
    assert identifiers == [
        "anchor-001-001",
        "anchor-001-001-001",
        "anchor-001-001-002",
        "anchor-001-002",
    ]

    parent_map = {cluster.subcluster_id: cluster.parent_subcluster_id for cluster in hierarchy}
    assert parent_map["anchor-001-001"] is None
    assert parent_map["anchor-001-001-001"] == "anchor-001-001"
    assert parent_map["anchor-001-001-002"] == "anchor-001-001"
    assert parent_map["anchor-001-002"] is None

    first_cluster = hierarchy.subclusters[0]
    assert first_cluster.store_ids == ("s1", "s2")
    assert first_cluster.metadata == {}
    child_scores = [cluster.metadata["score"] for cluster in hierarchy.subclusters[1:3]]
    assert child_scores == [0.8, 0.2]


def test_build_subcluster_hierarchy_to_frame_round_trip():
    specs = [
        SubClusterNodeSpec(key="root", parent_key=None, store_ids=("s1", "s2")),
        SubClusterNodeSpec(key="leaf", parent_key="root", store_ids=("s1",), centroid_lat=41.0, centroid_lon=-87.0),
    ]

    hierarchy = build_subcluster_hierarchy("anchor-xyz", specs)
    frame = hierarchy.to_frame()

    assert list(frame.columns) == [
        "anchor_id",
        "subcluster_id",
        "parent_subcluster_id",
        "lineage",
        "depth",
        "store_count",
        "store_ids",
        "centroid_lat",
        "centroid_lon",
        "metadata",
    ]

    assert frame.iloc[0]["anchor_id"] == "anchor-xyz"
    assert frame.iloc[1]["parent_subcluster_id"] == frame.iloc[0]["subcluster_id"]
    assert frame.iloc[1]["lineage"] == "001.001"
    assert frame.iloc[1]["store_count"] == 1
    assert frame.iloc[1]["centroid_lat"] == pytest.approx(41.0)

    json_records = hierarchy.to_records()
    assert json_records[0]["store_ids"] == ["s1", "s2"]


def test_build_subcluster_hierarchy_rejects_invalid_structures():
    with pytest.raises(SubClusterTopologyError):
        build_subcluster_hierarchy(
            "anchor", [SubClusterNodeSpec(key="child", parent_key="missing", store_ids=("s1",))]
        )

    with pytest.raises(SubClusterTopologyError):
        build_subcluster_hierarchy(
            "anchor",
            [
                SubClusterNodeSpec(key="a", parent_key="b", store_ids=("s1",)),
                SubClusterNodeSpec(key="b", parent_key="a", store_ids=("s2",)),
            ],
        )

    with pytest.raises(SubClusterTopologyError):
        build_subcluster_hierarchy(
            "anchor",
            [
                SubClusterNodeSpec(key="dup", parent_key=None, store_ids=("s1",)),
                SubClusterNodeSpec(key="dup", parent_key=None, store_ids=("s2",)),
            ],
        )

