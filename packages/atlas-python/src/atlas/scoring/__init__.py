"""Scoring utilities for the Atlas project."""

from .posterior import PosteriorPipeline, PosteriorPrediction
from .prior import (
    PriorScoreResult,
    clamp_score,
    compute_prior_score,
    get_affluence_coefficients,
    get_type_baseline,
    knn_adjacency_smoothing,
)

__all__ = [
    "PosteriorPipeline",
    "PosteriorPrediction",
    "PriorScoreResult",
    "clamp_score",
    "compute_prior_score",
    "get_affluence_coefficients",
    "get_type_baseline",
    "knn_adjacency_smoothing",
]
