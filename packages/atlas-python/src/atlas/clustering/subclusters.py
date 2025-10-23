"""Sub-cluster nesting utilities for Atlas anchors."""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Dict, Mapping, MutableMapping, Sequence


MetadataValue = float | int | str


class SubClusterTopologyError(RuntimeError):
    """Raised when a sub-cluster hierarchy contains structural issues."""


@dataclass(frozen=True, slots=True)
class SubClusterNodeSpec:
    """Specification for a sub-cluster prior to identifier assignment."""

    key: str
    store_ids: Sequence[str]
    parent_key: str | None = None
    centroid_lat: float | None = None
    centroid_lon: float | None = None
    metadata: Mapping[str, MetadataValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.key:
            raise ValueError("Sub-cluster specification requires a non-empty key")
        if not self.store_ids:
            raise ValueError("Sub-cluster specification requires at least one store id")

        normalised_store_ids = tuple(sorted({str(store_id) for store_id in self.store_ids}))
        object.__setattr__(self, "store_ids", normalised_store_ids)

        metadata = dict(self.metadata)
        for key in metadata:
            metadata[key] = self._coerce_metadata_value(metadata[key])
        object.__setattr__(self, "metadata", MappingProxyType(metadata))

    @staticmethod
    def _coerce_metadata_value(value: MetadataValue | object) -> MetadataValue:
        if isinstance(value, (int, float, str)):
            return value
        raise TypeError(
            "Sub-cluster metadata values must be int, float, or str; "
            f"received {type(value)!r}"
        )


@dataclass(frozen=True, slots=True)
class SubCluster:
    """Represents a materialised sub-cluster with a stable identifier."""

    anchor_id: str
    subcluster_id: str
    parent_subcluster_id: str | None
    lineage: tuple[int, ...]
    store_ids: tuple[str, ...]
    centroid_lat: float | None = None
    centroid_lon: float | None = None
    metadata: Mapping[str, MetadataValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.anchor_id:
            raise ValueError("Sub-cluster requires a non-empty anchor_id")
        if not self.subcluster_id:
            raise ValueError("Sub-cluster requires a non-empty identifier")
        if not self.lineage:
            raise ValueError("Sub-cluster lineage cannot be empty")
        if not self.store_ids:
            raise ValueError("Sub-cluster requires at least one store id")

        object.__setattr__(self, "store_ids", tuple(self.store_ids))
        metadata = MappingProxyType(dict(self.metadata))
        object.__setattr__(self, "metadata", metadata)

    @property
    def depth(self) -> int:
        """Depth of the sub-cluster within the hierarchy (1-indexed)."""

        return len(self.lineage)

    @property
    def store_count(self) -> int:
        """Number of stores assigned to the sub-cluster."""

        return len(self.store_ids)

    @property
    def lineage_token(self) -> str:
        """Return the lineage encoded as a dotted ordinal path (e.g., ``001.002``)."""

        return ".".join(f"{part:03d}" for part in self.lineage)

    def to_record(self) -> Dict[str, object]:
        """Return a JSON-serialisable representation of the sub-cluster."""

        return {
            "anchor_id": self.anchor_id,
            "subcluster_id": self.subcluster_id,
            "parent_subcluster_id": self.parent_subcluster_id,
            "lineage": self.lineage_token,
            "depth": self.depth,
            "store_count": self.store_count,
            "store_ids": list(self.store_ids),
            "centroid_lat": self.centroid_lat,
            "centroid_lon": self.centroid_lon,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True, slots=True)
class SubClusterHierarchy:
    """Collection of sub-clusters belonging to a single anchor."""

    anchor_id: str
    subclusters: tuple[SubCluster, ...] = ()

    def __post_init__(self) -> None:
        for cluster in self.subclusters:
            if cluster.anchor_id != self.anchor_id:
                raise ValueError(
                    "All sub-clusters in a hierarchy must share the same anchor_id"
                )

    def __iter__(self):
        return iter(self.subclusters)

    def __len__(self) -> int:  # pragma: no cover - simple delegation
        return len(self.subclusters)

    def to_records(self) -> list[dict[str, object]]:
        """Return the hierarchy as a list of JSON-ready dictionaries."""

        return [cluster.to_record() for cluster in self.subclusters]

    def to_frame(self):  # pragma: no cover - simple pandas wrapper
        """Return the hierarchy as a pandas DataFrame suitable for persistence."""

        import pandas as pd

        records = self.to_records()
        if not records:
            return pd.DataFrame(
                columns=
                [
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
            )
        return pd.DataFrame.from_records(records)


def build_subcluster_hierarchy(
    anchor_id: str,
    specs: Sequence[SubClusterNodeSpec],
    *,
    id_prefix: str | None = None,
) -> SubClusterHierarchy:
    """Assign stable identifiers to sub-cluster specifications."""

    if not anchor_id:
        raise ValueError("anchor_id must be provided")

    if not specs:
        return SubClusterHierarchy(anchor_id, ())

    spec_by_key: Dict[str, SubClusterNodeSpec] = {}
    for spec in specs:
        if spec.key in spec_by_key:
            raise SubClusterTopologyError(
                f"Duplicate sub-cluster specification key '{spec.key}'"
            )
        spec_by_key[spec.key] = spec

    children: MutableMapping[str | None, list[SubClusterNodeSpec]] = {}
    for spec in specs:
        parent_key = spec.parent_key
        if parent_key is not None and parent_key not in spec_by_key:
            raise SubClusterTopologyError(
                f"Sub-cluster '{spec.key}' references unknown parent '{parent_key}'"
            )
        children.setdefault(parent_key, []).append(spec)

    _validate_for_cycles(children)

    prefix = id_prefix or anchor_id
    materialised: list[SubCluster] = []

    def assign(
        parent_key: str | None,
        parent_id: str | None,
        lineage_prefix: tuple[int, ...],
    ) -> None:
        candidates = children.get(parent_key, [])
        for ordinal, spec in enumerate(sorted(candidates, key=_sort_key), start=1):
            lineage = lineage_prefix + (ordinal,)
            subcluster_id = _format_subcluster_id(prefix, lineage)
            subcluster = SubCluster(
                anchor_id=anchor_id,
                subcluster_id=subcluster_id,
                parent_subcluster_id=parent_id,
                lineage=lineage,
                store_ids=spec.store_ids,
                centroid_lat=spec.centroid_lat,
                centroid_lon=spec.centroid_lon,
                metadata=spec.metadata,
            )
            materialised.append(subcluster)
            assign(spec.key, subcluster_id, lineage)

    assign(None, None, tuple())

    if len(materialised) != len(specs):
        raise SubClusterTopologyError("Failed to materialise all sub-cluster specifications")

    return SubClusterHierarchy(anchor_id, tuple(materialised))


def _sort_key(spec: SubClusterNodeSpec) -> tuple[int, tuple[str, ...]]:
    return (-len(spec.store_ids), spec.store_ids)


def _format_subcluster_id(prefix: str, lineage: Sequence[int]) -> str:
    suffix = "-".join(f"{ordinal:03d}" for ordinal in lineage)
    return f"{prefix}-{suffix}"


def _validate_for_cycles(
    children: Mapping[str | None, Sequence[SubClusterNodeSpec]]
) -> None:
    state: Dict[str, str] = {}

    def dfs(key: str) -> None:
        node_state = state.get(key)
        if node_state == "visiting":
            raise SubClusterTopologyError("Cycle detected in sub-cluster hierarchy")
        if node_state == "done":
            return
        state[key] = "visiting"
        for child in children.get(key, ()): 
            dfs(child.key)
        state[key] = "done"

    for roots in children.get(None, ()):  # type: ignore[arg-type]
        dfs(roots.key)

    visited = set(state)
    remaining = {
        child.key
        for specs in children.values()
        for child in specs
        if child.key not in visited
    }
    for key in remaining:
        dfs(key)


__all__ = [
    "MetadataValue",
    "SubCluster",
    "SubClusterHierarchy",
    "SubClusterNodeSpec",
    "SubClusterTopologyError",
    "build_subcluster_hierarchy",
]

