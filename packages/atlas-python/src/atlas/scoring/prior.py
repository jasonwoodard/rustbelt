"""Prior scoring utilities for the Atlas Value–Yield model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

import numpy as np
import pandas as pd

from ..explain import TraceRecord, hash_payload


Score = float


@dataclass(frozen=True, slots=True)
class TypeBaseline:
    """Baseline priors for a given store type."""

    value: Score
    yield_score: Score


@dataclass(frozen=True, slots=True)
class AffluenceCoefficients:
    """Affluence adjustment coefficients for a store type."""

    alpha_income: float
    alpha_high_income: float
    beta_renter: float


TYPE_BASELINES: Dict[str, TypeBaseline] = {
    "Thrift": TypeBaseline(value=2.8, yield_score=3.4),
    "Antique": TypeBaseline(value=4.0, yield_score=2.0),
    "Vintage": TypeBaseline(value=3.8, yield_score=2.8),
    "Flea/Surplus": TypeBaseline(value=3.0, yield_score=3.0),
    "Unknown": TypeBaseline(value=3.0, yield_score=3.0),
}

AFFLUENCE_COEFFICIENTS: Dict[str, AffluenceCoefficients] = {
    "Thrift": AffluenceCoefficients(alpha_income=0.5, alpha_high_income=0.5, beta_renter=-0.5),
    "Antique": AffluenceCoefficients(alpha_income=0.1, alpha_high_income=0.1, beta_renter=-0.1),
    "Vintage": AffluenceCoefficients(alpha_income=0.5, alpha_high_income=0.3, beta_renter=-1.0),
    "Flea/Surplus": AffluenceCoefficients(alpha_income=0.2, alpha_high_income=0.2, beta_renter=-0.3),
    "Unknown": AffluenceCoefficients(alpha_income=0.2, alpha_high_income=0.2, beta_renter=-0.3),
}


def get_type_baseline(store_type: str) -> TypeBaseline:
    """Return the baseline scores for the provided ``store_type``."""

    return TYPE_BASELINES.get(store_type, TYPE_BASELINES["Unknown"])


def get_affluence_coefficients(store_type: str) -> AffluenceCoefficients:
    """Return affluence coefficients for the provided ``store_type``."""

    return AFFLUENCE_COEFFICIENTS.get(store_type, AFFLUENCE_COEFFICIENTS["Unknown"])


def clamp_score(score: float, *, lower: float = 1.0, upper: float = 5.0) -> float:
    """Clamp ``score`` to the inclusive ``lower``/``upper`` bounds."""

    return max(lower, min(upper, score))


@dataclass(slots=True)
class PriorScoreResult:
    """Structured result for prior Value/Yield computations."""

    value: Score
    yield_score: Score
    composite: Score | None

    baseline_value: Score
    baseline_yield: Score

    income_contribution: Score
    high_income_contribution: Score
    renter_contribution: Score

    adjacency_value_adjustment: Score
    adjacency_yield_adjustment: Score

    posterior_value_override: Score | None = None
    posterior_yield_override: Score | None = None

    trace: TraceRecord | None = None

    def to_trace(self) -> Dict[str, float | None]:
        """Return a dictionary suitable for structured logging."""

        if self.trace is not None:
            return self.trace.to_dict()

        return {
            "value": self.value,
            "yield": self.yield_score,
            "composite": self.composite,
            "baseline_value": self.baseline_value,
            "baseline_yield": self.baseline_yield,
            "income_contribution": self.income_contribution,
            "high_income_contribution": self.high_income_contribution,
            "renter_contribution": self.renter_contribution,
            "adjacency_value_adjustment": self.adjacency_value_adjustment,
            "adjacency_yield_adjustment": self.adjacency_yield_adjustment,
            "posterior_value_override": self.posterior_value_override,
            "posterior_yield_override": self.posterior_yield_override,
        }


def compute_prior_score(
    store_type: str,
    *,
    store_id: str | None = None,
    median_income_norm: float = 0.0,
    pct_hh_100k_norm: float = 0.0,
    pct_renter_norm: float = 0.0,
    lambda_weight: float | None = None,
    clamp: bool = True,
    adjacency_adjustment: tuple[float, float] | None = None,
    posterior_overrides: tuple[Score | None, Score | None] | None = None,
) -> PriorScoreResult:
    """Compute prior Value/Yield scores for a single store.

    Parameters
    ----------
    store_type:
        The normalized store type label (e.g., ``"Thrift"``).
    store_id:
        Optional canonical identifier for the store. Defaults to ``store_type``
        when omitted to preserve backwards compatibility with older callers.
    median_income_norm, pct_hh_100k_norm, pct_renter_norm:
        Normalized affluence inputs from the spec (0–1 range recommended).
    lambda_weight:
        Optional weight for the Value component when computing a composite
        ``J = λ·Value + (1-λ)·Yield``. Pass ``None`` to skip composite
        calculation.
    clamp:
        Clamp the final Value, Yield, and Composite scores to ``[1, 5]`` when
        ``True``.
    adjacency_adjustment:
        Optional ``(ΔValue, ΔYield)`` pair produced by adjacency smoothing.
    posterior_overrides:
        Optional ``(Value, Yield)`` overrides reserved for future posterior
        blending. Overrides are recorded on the result but not applied in
        ``Prior-only`` mode.
    """

    baseline = get_type_baseline(store_type)
    coeffs = get_affluence_coefficients(store_type)

    income_contribution = coeffs.alpha_income * median_income_norm
    high_income_contribution = coeffs.alpha_high_income * pct_hh_100k_norm
    renter_contribution = coeffs.beta_renter * pct_renter_norm

    value = baseline.value + income_contribution + high_income_contribution
    yield_score = baseline.yield_score + renter_contribution

    adjacency_value_adjustment = 0.0
    adjacency_yield_adjustment = 0.0
    if adjacency_adjustment is not None:
        adjacency_value_adjustment, adjacency_yield_adjustment = adjacency_adjustment
        value += adjacency_value_adjustment
        yield_score += adjacency_yield_adjustment

    composite: float | None = None

    if lambda_weight is not None:
        composite = (lambda_weight * value) + ((1.0 - lambda_weight) * yield_score)

    if clamp:
        value = clamp_score(value)
        yield_score = clamp_score(yield_score)
        if composite is not None:
            composite = clamp_score(composite)

    posterior_value_override = None
    posterior_yield_override = None
    if posterior_overrides is not None:
        posterior_value_override, posterior_yield_override = posterior_overrides

    trace_payload = {
        "baseline": {
            "value": baseline.value,
            "yield": baseline.yield_score,
        },
        "coefficients": {
            "alpha_income": coeffs.alpha_income,
            "alpha_high_income": coeffs.alpha_high_income,
            "beta_renter": coeffs.beta_renter,
        },
        "adjacency": adjacency_adjustment,
        "lambda_weight": lambda_weight,
        "posterior_overrides": posterior_overrides,
    }

    canonical_store_id = store_id if store_id is not None else store_type

    trace = TraceRecord(
        store_id=canonical_store_id,
        stage="prior",
        metadata={
            "store_type": store_type,
        },
        baseline={
            "value": baseline.value,
            "yield": baseline.yield_score,
        },
        affluence={
            "income": income_contribution,
            "high_income": high_income_contribution,
            "renter": renter_contribution,
        },
        adjacency={
            "value": adjacency_value_adjustment,
            "yield": adjacency_yield_adjustment,
        },
        observations={
            "lambda_weight": lambda_weight,
        },
        model={
            "parameters_hash": hash_payload(trace_payload),
            "posterior_overrides_present": posterior_overrides is not None,
        },
        scores={
            "value": value,
            "yield": yield_score,
            "composite": composite,
        },
    )

    return PriorScoreResult(
        value=value,
        yield_score=yield_score,
        composite=composite,
        baseline_value=baseline.value,
        baseline_yield=baseline.yield_score,
        income_contribution=income_contribution,
        high_income_contribution=high_income_contribution,
        renter_contribution=renter_contribution,
        adjacency_value_adjustment=adjacency_value_adjustment,
        adjacency_yield_adjustment=adjacency_yield_adjustment,
        posterior_value_override=posterior_value_override,
        posterior_yield_override=posterior_yield_override,
        trace=trace,
    )


def _validate_knn_parameters(k: int, smoothing_factor: float) -> None:
    if k < 1:
        raise ValueError("k must be >= 1 for adjacency smoothing")
    if not (0.0 <= smoothing_factor <= 1.0):
        raise ValueError("smoothing_factor must fall within [0, 1]")


def knn_adjacency_smoothing(
    frame: pd.DataFrame,
    *,
    lat_col: str = "Latitude",
    lon_col: str = "Longitude",
    value_col: str = "Value",
    yield_col: str = "Yield",
    k: int = 3,
    smoothing_factor: float = 0.5,
    distance_epsilon: float = 1e-6,
) -> pd.DataFrame:
    """Return smoothed Value/Yield scores using spatial k-NN averaging.

    The function mixes each store's scores with the inverse distance-weighted
    average of its ``k`` nearest neighbours. A ``smoothing_factor`` of ``0``
    leaves scores untouched, while ``1`` fully replaces them with the neighbour
    average.
    """

    _validate_knn_parameters(k, smoothing_factor)

    if frame.empty or smoothing_factor == 0.0:
        return frame[[value_col, yield_col]].assign(
            value_smoothed=frame[value_col],
            yield_smoothed=frame[yield_col],
            value_adjustment=0.0,
            yield_adjustment=0.0,
        )

    coords = frame[[lat_col, lon_col]].to_numpy(dtype=float)
    values = frame[value_col].to_numpy(dtype=float)
    yields = frame[yield_col].to_numpy(dtype=float)

    if len(coords) <= k:
        k = len(coords) - 1
    if k < 1:
        return frame[[value_col, yield_col]].assign(
            value_smoothed=frame[value_col],
            yield_smoothed=frame[yield_col],
            value_adjustment=0.0,
            yield_adjustment=0.0,
        )

    deltas_value = np.zeros(len(coords), dtype=float)
    deltas_yield = np.zeros(len(coords), dtype=float)

    diff = coords[:, None, :] - coords[None, :, :]
    distances = np.sqrt(np.sum(diff**2, axis=2))

    np.fill_diagonal(distances, np.inf)

    for idx in range(len(coords)):
        neighbor_idx = np.argpartition(distances[idx], k)[:k]
        neighbor_distances = distances[idx, neighbor_idx]
        weights = 1.0 / (neighbor_distances + distance_epsilon)
        weight_sum = np.sum(weights)
        if weight_sum == 0:
            continue
        neighbor_value = float(np.dot(values[neighbor_idx], weights) / weight_sum)
        neighbor_yield = float(np.dot(yields[neighbor_idx], weights) / weight_sum)

        mixed_value = (1.0 - smoothing_factor) * values[idx] + smoothing_factor * neighbor_value
        mixed_yield = (1.0 - smoothing_factor) * yields[idx] + smoothing_factor * neighbor_yield

        deltas_value[idx] = mixed_value - values[idx]
        deltas_yield[idx] = mixed_yield - yields[idx]

    result = frame[[value_col, yield_col]].copy()
    result["value_smoothed"] = values + deltas_value
    result["yield_smoothed"] = yields + deltas_yield
    result["value_adjustment"] = deltas_value
    result["yield_adjustment"] = deltas_yield

    return result


__all__ = [
    "PriorScoreResult",
    "TypeBaseline",
    "AffluenceCoefficients",
    "AFFLUENCE_COEFFICIENTS",
    "TYPE_BASELINES",
    "clamp_score",
    "compute_prior_score",
    "get_affluence_coefficients",
    "get_type_baseline",
    "knn_adjacency_smoothing",
]
