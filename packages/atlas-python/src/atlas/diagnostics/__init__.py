"""Utilities for computing diagnostics over Atlas scoring outputs."""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, TypedDict

import pandas as pd

from .writers import (
    DIAGNOSTICS_BASENAME,
    DIAGNOSTICS_VERSION,
    write_html,
    write_json,
    write_parquet,
)


CorrelationMatrix = Dict[str, Dict[str, float]]


class CorrelationTable(TypedDict):
    """Nested mapping representing pairwise correlations.

    Attributes
    ----------
    method:
        Correlation method applied (``"pearson"``, ``"spearman"`` or ``"kendall"``).
    values:
        Symmetric matrix encoded as ``{column: {other_column: coefficient}}``.
        Only pairs with at least the requested minimum non-null observations are
        included in the output.
    """

    method: str
    values: CorrelationMatrix


class DistributionSummary(TypedDict):
    """Summary statistics for a single metric.

    Attributes
    ----------
    count:
        Number of non-null observations used to compute the summary.
    missing:
        Number of missing values that were excluded from the summary.
    mean:
        Arithmetic mean of the metric, or ``NaN`` when ``count == 0``.
    variance:
        Population variance (``ddof=0``), or ``NaN`` when ``count == 0``.
    quantiles:
        Mapping of requested quantile -> value. Quantile keys are the raw float
        probabilities supplied to :func:`summarize_distributions`.
    """

    count: int
    missing: int
    mean: float
    variance: float
    quantiles: Dict[float, float]


class AnchorLeverageSignal(TypedDict):
    """Description of a high leverage anchor."""

    anchor: str
    share: float
    count: float


class OutlierScoreSignal(TypedDict):
    """Description of an outlier score observation."""

    index: str
    score: float
    z_score: float


class QASignals(TypedDict):
    """Quality assurance heuristics derived from score diagnostics."""

    high_leverage_anchors: List[AnchorLeverageSignal]
    outlier_scores: List[OutlierScoreSignal]
    warnings: List[str]


def compute_correlation_table(
    frame: pd.DataFrame,
    *,
    columns: Optional[Sequence[str]] = None,
    method: str = "pearson",
    minimum_non_null: int = 2,
) -> CorrelationTable:
    """Compute a nested correlation table for the requested columns.

    Parameters
    ----------
    frame:
        Source data containing score components or diagnostic inputs.
    columns:
        Optional subset of columns to include. When omitted, numeric columns
        are automatically selected.
    method:
        Correlation method to apply. Any value accepted by
        :meth:`pandas.DataFrame.corr` is valid.
    minimum_non_null:
        Minimum observations required for a pairwise correlation to be
        reported.

    Returns
    -------
    CorrelationTable
        A dictionary containing the ``method`` used and a nested ``values``
        mapping encoding the symmetric correlation matrix.
    """

    if columns is None:
        columns = [col for col in frame.columns if pd.api.types.is_numeric_dtype(frame[col])]
    else:
        missing = [col for col in columns if col not in frame.columns]
        if missing:
            raise KeyError(f"Columns not found in frame: {missing}")

    if not columns:
        return CorrelationTable(method=method, values={})

    data = frame.loc[:, list(dict.fromkeys(columns))]
    data = data.dropna(axis=0, how="all")

    valid_columns = [col for col in data.columns if data[col].count() >= minimum_non_null]
    if not valid_columns:
        return CorrelationTable(method=method, values={})

    corr = data.loc[:, valid_columns].corr(method=method, min_periods=minimum_non_null)

    values: CorrelationMatrix = {}
    for column in corr.columns:
        col_series = corr[column].dropna()
        values[column] = {other: float(col_series[other]) for other in col_series.index}

    return CorrelationTable(method=method, values=values)


def summarize_distributions(
    frame: pd.DataFrame,
    *,
    metrics: Optional[Sequence[str]] = None,
    quantiles: Sequence[float] = (0.05, 0.5, 0.95),
) -> Dict[str, DistributionSummary]:
    """Summarize distributions for the requested metrics.

    Parameters
    ----------
    frame:
        DataFrame containing diagnostic metrics.
    metrics:
        Optional subset of metrics to summarize. When omitted, all numeric
        columns in *frame* are used.
    quantiles:
        Iterable of quantile probabilities in the inclusive interval ``[0, 1]``.

    Returns
    -------
    Dict[str, DistributionSummary]
        Mapping of metric name -> :class:`DistributionSummary` describing mean,
        variance, count, missing observations, and quantiles.
    """

    if metrics is None:
        metrics = [col for col in frame.columns if pd.api.types.is_numeric_dtype(frame[col])]
    else:
        missing = [col for col in metrics if col not in frame.columns]
        if missing:
            raise KeyError(f"Metrics not found in frame: {missing}")

    quantiles = tuple(sorted(dict.fromkeys(float(q) for q in quantiles)))
    for q in quantiles:
        if not 0.0 <= q <= 1.0:
            raise ValueError(f"Quantile {q} is outside the inclusive [0, 1] range")

    summaries: Dict[str, DistributionSummary] = {}
    for metric in metrics:
        series = frame[metric]
        valid = series.dropna()
        count = int(valid.count())
        missing = int(series.isna().sum())

        if count == 0:
            mean = math.nan
            variance = math.nan
            q_values = {q: math.nan for q in quantiles}
        else:
            mean = float(valid.mean())
            variance = float(valid.var(ddof=0))
            q_values = {q: float(valid.quantile(q, interpolation="linear")) for q in quantiles}

        summaries[metric] = DistributionSummary(
            count=count,
            missing=missing,
            mean=mean,
            variance=variance,
            quantiles=q_values,
        )

    return summaries


def generate_qa_signals(
    frame: pd.DataFrame,
    *,
    score_column: str,
    anchor_column: Optional[str] = None,
    weight_column: Optional[str] = None,
    leverage_threshold: float = 0.1,
    outlier_sigma: float = 3.0,
) -> QASignals:
    """Compute heuristic QA signals for Atlas scores.

    Parameters
    ----------
    frame:
        Source data containing scores and optional metadata.
    score_column:
        Column containing the numeric scores to inspect.
    anchor_column:
        Optional categorical column identifying anchors to evaluate for leverage.
    weight_column:
        Optional numeric column providing weights when calculating anchor
        leverage. When omitted, raw counts are used.
    leverage_threshold:
        Anchors whose share of the total volume meets or exceeds this threshold
        are flagged as high leverage.
    outlier_sigma:
        Absolute Z-score threshold used to flag outlier score observations.

    Returns
    -------
    QASignals
        A dictionary with ``high_leverage_anchors``, ``outlier_scores`` and
        ``warnings`` entries.
    """

    if score_column not in frame.columns:
        raise KeyError(f"Score column '{score_column}' not present in frame")

    warnings: List[str] = []

    high_leverage: List[AnchorLeverageSignal] = []
    if anchor_column is not None:
        if anchor_column not in frame.columns:
            raise KeyError(f"Anchor column '{anchor_column}' not present in frame")

        if weight_column is not None and weight_column not in frame.columns:
            raise KeyError(f"Weight column '{weight_column}' not present in frame")

        grouped = frame[[anchor_column]]
        if weight_column is not None:
            weights = frame[weight_column].fillna(0)
            contributions = (
                frame.assign(_weight=weights)
                .groupby(anchor_column, dropna=False)["_weight"]
                .sum()
            )
        else:
            contributions = grouped[anchor_column].value_counts(dropna=False)

        total = float(contributions.sum())
        if total <= 0:
            warnings.append("Anchor leverage could not be computed (no total volume)")
        else:
            for anchor, count in contributions.items():
                share = float(count) / total
                if share >= leverage_threshold:
                    high_leverage.append(
                        AnchorLeverageSignal(
                            anchor=str(anchor),
                            share=share,
                            count=float(count),
                        )
                    )

    outlier_scores: List[OutlierScoreSignal] = []
    scores = frame[score_column].dropna()
    if scores.empty:
        warnings.append("No non-null scores available for QA checks")
    else:
        std = float(scores.std(ddof=0))
        mean = float(scores.mean())
        if math.isclose(std, 0.0):
            warnings.append("Score standard deviation is zero; outlier detection skipped")
        else:
            z_scores = (frame[score_column] - mean) / std
            mask = z_scores.abs() >= outlier_sigma
            for index, score in frame.loc[mask, score_column].items():
                z = float(z_scores.loc[index])
                outlier_scores.append(
                    OutlierScoreSignal(
                        index=str(index),
                        score=float(score),
                        z_score=float(z),
                    )
                )

    return QASignals(
        high_leverage_anchors=sorted(high_leverage, key=lambda signal: signal["share"], reverse=True),
        outlier_scores=outlier_scores,
        warnings=warnings,
    )


__all__ = [
    "DIAGNOSTICS_BASENAME",
    "DIAGNOSTICS_VERSION",
    "AnchorLeverageSignal",
    "CorrelationMatrix",
    "CorrelationTable",
    "DistributionSummary",
    "QASignals",
    "compute_correlation_table",
    "generate_qa_signals",
    "write_html",
    "write_json",
    "write_parquet",
    "summarize_distributions",
]

