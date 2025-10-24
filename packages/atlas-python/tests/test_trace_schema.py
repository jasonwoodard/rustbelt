"""Validation tests for the Atlas trace schema."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from atlas.cli.__main__ import _build_blend_trace_records
from atlas.explain.trace import TRACE_SCHEMA_VERSION
from atlas.scoring import compute_prior_score

try:
    import jsonschema
except ImportError:  # pragma: no cover - optional dependency
    jsonschema = None


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_DIR = REPO_ROOT / "schema" / "atlas" / TRACE_SCHEMA_VERSION
TRACE_SCHEMA_PATH = SCHEMA_DIR / "trace.schema.json"
TRACE_EXAMPLES_PATH = SCHEMA_DIR / "trace-record.example.json"


@pytest.fixture(scope="module")
def trace_schema() -> dict[str, object]:
    with TRACE_SCHEMA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def trace_examples() -> list[dict[str, object]]:
    with TRACE_EXAMPLES_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.mark.skipif(jsonschema is None, reason="jsonschema library is not installed")
def test_trace_examples_validate_against_schema(trace_schema, trace_examples) -> None:
    validator = jsonschema.Draft202012Validator(trace_schema)
    for example in trace_examples:
        validator.validate(example)


@pytest.mark.skipif(jsonschema is None, reason="jsonschema library is not installed")
def test_prior_trace_matches_schema(trace_schema) -> None:
    trace_payload = compute_prior_score(
        "Thrift",
        store_id="trace-prior",
        median_income_norm=0.5,
        pct_hh_100k_norm=0.4,
        pct_renter_norm=0.3,
        lambda_weight=0.6,
    ).to_trace()

    validator = jsonschema.Draft202012Validator(trace_schema)
    validator.validate(trace_payload)


@pytest.mark.skipif(jsonschema is None, reason="jsonschema library is not installed")
def test_blend_trace_matches_schema(trace_schema) -> None:
    frame = pd.DataFrame(
        {
            "StoreId": ["trace-store"],
            "Omega": [0.5],
            "ValuePrior": [3.2],
            "ValuePosterior": [3.5],
            "Value": [3.4],
            "YieldPrior": [3.1],
            "YieldPosterior": [3.6],
            "Yield": [3.5],
            "CompositePrior": [3.15],
            "Composite": [3.45],
        }
    )

    records = _build_blend_trace_records(frame, lambda_weight=0.4)
    assert len(records) == 1

    validator = jsonschema.Draft202012Validator(trace_schema)
    for record in records:
        validator.validate(record)


@pytest.mark.skipif(jsonschema is not None, reason="jsonschema available; snapshot fallback not required")
def test_trace_schema_snapshot_fallback(trace_examples) -> None:
    # When jsonschema is unavailable, ensure the bundled examples still expose the
    # expected metadata so downstream tooling can perform lightweight validation.
    assert all(example["metadata.schema_version"] == TRACE_SCHEMA_VERSION for example in trace_examples)
    assert {example["stage"] for example in trace_examples} == {"prior", "posterior", "blend"}
    assert all(example["store_id"] for example in trace_examples)
