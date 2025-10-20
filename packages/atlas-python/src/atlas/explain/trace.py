"""Structured tracing utilities for Atlas scoring pipelines."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from typing import Any, Mapping, Sequence


def _normalise_for_hash(value: Any) -> Any:
    """Return a JSON-serialisable representation of ``value``."""

    if isinstance(value, Mapping):
        return {str(key): _normalise_for_hash(sub_value) for key, sub_value in sorted(value.items())}

    if isinstance(value, (list, tuple)):
        return [_normalise_for_hash(item) for item in value]

    if isinstance(value, set):
        return sorted(_normalise_for_hash(item) for item in value)

    if hasattr(value, "tolist"):
        try:
            return value.tolist()  # type: ignore[no-any-return]
        except Exception:  # pragma: no cover - defensive
            pass

    if hasattr(value, "item") and callable(getattr(value, "item")):
        try:
            return value.item()  # type: ignore[no-any-return]
        except Exception:  # pragma: no cover - defensive
            pass

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if hasattr(value, "__dict__"):
        return {
            str(key): _normalise_for_hash(sub_value)
            for key, sub_value in sorted(vars(value).items())
        }

    return repr(value)


def hash_payload(payload: Any) -> str:
    """Return a stable SHA-256 hash for ``payload``.

    The helper normalises the payload into a JSON serialisable structure so
    that callers can pass dataclasses, ``numpy`` arrays, or other lightweight
    containers without worrying about ordering semantics.
    """

    normalised = _normalise_for_hash(payload)
    encoded = json.dumps(normalised, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class TraceRecord:
    """Structured trace capturing the intermediate scoring contributions."""

    store_id: str
    stage: str
    baseline: dict[str, Any] = field(default_factory=dict)
    affluence: dict[str, Any] = field(default_factory=dict)
    adjacency: dict[str, Any] = field(default_factory=dict)
    observations: dict[str, Any] = field(default_factory=dict)
    model: dict[str, Any] = field(default_factory=dict)
    scores: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a flattened dictionary suitable for JSON/CSV output."""

        flattened: dict[str, Any] = {
            "store_id": self.store_id,
            "stage": self.stage,
        }

        for section_name, section in (
            ("baseline", self.baseline),
            ("affluence", self.affluence),
            ("adjacency", self.adjacency),
            ("observations", self.observations),
            ("model", self.model),
            ("scores", self.scores),
        ):
            for key, value in section.items():
                flattened[f"{section_name}.{key}"] = value

        return flattened


def ensure_sequence(value: Sequence[TraceRecord] | TraceRecord) -> list[TraceRecord]:
    """Coerce ``value`` into a list of ``TraceRecord`` instances."""

    if isinstance(value, TraceRecord):
        return [value]
    return list(value)


__all__ = ["TraceRecord", "ensure_sequence", "hash_payload"]

