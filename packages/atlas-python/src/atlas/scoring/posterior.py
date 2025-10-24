"""Posterior scoring pipeline for the Atlas Value–Yield model.

The implementation provided here intentionally favours clarity over raw
performance – the sample sizes used in the prototype are small and the
pipeline is primarily exercised in unit tests.  The goal is to mirror the
behaviour described in the product specification:

* Fit Poisson and (when necessary) Negative-Binomial GLMs to predict the
  purchase rate ``θ`` (items per 45 minutes) using dwell time offsets.
* Fit an OLS model to recover Value (``HaulLikert``) while respecting the
  ordinal nature of the target by clamping the final predictions to ``[1, 5]``.
* When per-store samples are sparse, fall back to hierarchical pooling or a
  spatial k-NN smoother.
* Persist the ECDF reference window used to map ``θ`` to the operational
  1–5 Yield scale so that subsequent runs remain reproducible.

The module is deliberately self-contained to keep the dependency footprint
light (``numpy`` and ``pandas`` only).  The GLM solvers implement a small IRLS
loop tailored to the required log-link families.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np
import pandas as pd

from .prior import clamp_score
from ..explain import TraceRecord, hash_payload


DEFAULT_WINDOW = "corpus"


class _GLMConvergenceError(RuntimeError):
    """Raised when the IRLS solver fails to converge."""


@dataclass(slots=True)
class _GLMResult:
    beta: np.ndarray
    covariance: np.ndarray
    dispersion: float
    family: str

    def predict(
        self,
        design_matrix: np.ndarray,
        *,
        offset: np.ndarray | float | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return (mu, standard_error) for the supplied design matrix."""

        if offset is None:
            offset_array = np.zeros(len(design_matrix), dtype=float)
        elif np.isscalar(offset):
            offset_array = np.full(len(design_matrix), float(offset), dtype=float)
        else:
            offset_array = np.asarray(offset, dtype=float)

        eta = offset_array + design_matrix @ self.beta
        mu = np.exp(eta)

        # Delta method: var(exp(η)) ≈ (exp(η)**2) * var(η)
        var_eta = np.einsum("ij,jk,ik->i", design_matrix, self.covariance, design_matrix)
        var_eta = np.clip(var_eta, 0.0, None) * self.dispersion
        se = np.sqrt(var_eta) * mu

        return mu, se


@dataclass(slots=True)
class _LinearModelResult:
    beta: np.ndarray
    covariance: np.ndarray
    dispersion: float

    def predict(self, design_matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        mu = design_matrix @ self.beta
        var = np.einsum("ij,jk,ik->i", design_matrix, self.covariance, design_matrix)
        var = np.clip(var, 0.0, None) * self.dispersion
        se = np.sqrt(var)
        return mu, se


def _solve_glm(
    design_matrix: np.ndarray,
    response: np.ndarray,
    *,
    offset: np.ndarray,
    alpha: float = 0.0,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> _GLMResult:
    """Fit a log-link GLM using iteratively re-weighted least squares.

    Parameters
    ----------
    design_matrix:
        Feature matrix with an intercept column already included.
    response:
        Observed counts ``y``.
    offset:
        Log exposure term (``log(dwell_minutes/45)``).
    alpha:
        Over-dispersion coefficient. ``0`` produces a Poisson GLM, while
        positive values approximate a Negative-Binomial with
        ``Var[Y] = μ + α·μ²``.
    """

    beta = np.zeros(design_matrix.shape[1], dtype=float)
    offset = np.asarray(offset, dtype=float)
    response = np.asarray(response, dtype=float)

    if not np.isfinite(design_matrix).all():  # pragma: no cover - defensive
        raise ValueError("Design matrix contains NaNs or infs")

    for iteration in range(max_iter):
        eta = offset + design_matrix @ beta
        mu = np.exp(eta)
        mu = np.clip(mu, 1e-9, None)

        variance = mu + alpha * mu**2
        weights = mu**2 / variance

        z = eta + (response - mu) / mu

        xtw = design_matrix.T * weights
        xtwx = xtw @ design_matrix
        xtwz = xtw @ z

        try:
            beta_new = np.linalg.solve(xtwx, xtwz)
        except np.linalg.LinAlgError as exc:  # pragma: no cover - rare
            raise _GLMConvergenceError("Singular design matrix in IRLS") from exc

        if np.linalg.norm(beta_new - beta, ord=np.inf) < tol:
            beta = beta_new
            break

        beta = beta_new
    else:  # pragma: no cover - should not happen in tests
        raise _GLMConvergenceError("GLM failed to converge")

    eta = offset + design_matrix @ beta
    mu = np.exp(eta)
    variance = mu + alpha * mu**2
    weights = mu**2 / variance
    xtw = design_matrix.T * weights
    xtwx = xtw @ design_matrix
    dispersion = float(
        np.sum(((response - mu) ** 2) / variance) / max(len(response) - design_matrix.shape[1], 1)
    )

    try:
        covariance = np.linalg.inv(xtwx)
    except np.linalg.LinAlgError:  # pragma: no cover - fallback when poorly conditioned
        covariance = np.linalg.pinv(xtwx)

    family = "NegBin" if alpha > 0.0 else "Poisson"

    return _GLMResult(beta=beta, covariance=covariance, dispersion=dispersion, family=family)


def _design_matrix(frame: pd.DataFrame, columns: Sequence[str]) -> np.ndarray:
    matrix = frame.loc[:, columns].to_numpy(dtype=float, copy=True)
    intercept = np.ones((len(frame), 1), dtype=float)
    return np.hstack((intercept, matrix))


def _prepare_features(
    stores: pd.DataFrame,
    feature_columns: Sequence[str] | None,
) -> tuple[pd.DataFrame, list[str], dict[str, tuple[float, float]]]:
    numeric = stores.select_dtypes(include=[np.number]).copy()

    if feature_columns is None:
        feature_columns = [column for column in numeric.columns if column not in {"Latitude", "Longitude", "Lat", "Lon"}]
    else:
        feature_columns = list(feature_columns)

    for column in feature_columns:
        if column not in stores:
            raise KeyError(f"Feature column '{column}' missing from store frame")

    features = stores.copy()
    stats: dict[str, tuple[float, float]] = {}
    for column in feature_columns:
        values = features[column].astype(float)
        mean = float(values.mean())
        std = float(values.std(ddof=0))
        if std == 0.0:
            std = 1.0
        features[column] = (values - mean) / std
        stats[column] = (mean, std)

    return features, feature_columns, stats


def _summarise_observations(frame: pd.DataFrame) -> pd.DataFrame:
    dwell = frame["DwellMin"].astype(float).clip(lower=1e-6)
    items = frame["PurchasedItems"].astype(float).clip(lower=0.0)
    theta = items / (dwell / 45.0)

    summary = (
        frame.assign(theta=theta)
        .groupby("StoreId", as_index=True)
        .agg(
            visits=("StoreId", "count"),
            dwell_total=("DwellMin", "sum"),
            items_total=("PurchasedItems", "sum"),
            value_mean=("HaulLikert", "mean"),
            value_var=("HaulLikert", "var"),
            theta_mean=("theta", "mean"),
        )
    )

    summary["value_var"] = summary["value_var"].fillna(0.0)
    summary["exposure"] = summary["dwell_total"].clip(lower=1e-6) / 45.0

    return summary


def _estimate_overdispersion(summary: pd.DataFrame) -> float:
    if summary.empty:
        return 0.0

    mean_rate = (summary["items_total"].sum() / summary["exposure"].sum()).clip(min=1e-6)
    var_rate = float(np.var(summary["theta_mean"], ddof=1))

    if var_rate <= mean_rate:
        return 0.0

    alpha = (var_rate - mean_rate) / (mean_rate**2)
    return float(max(alpha, 0.0))


def _build_ecdf_reference(
    observations: pd.DataFrame,
    *,
    window_column: str | None,
) -> pd.DataFrame:
    dwell = observations["DwellMin"].astype(float).clip(lower=1e-6)
    theta = observations["PurchasedItems"].astype(float) / (dwell / 45.0)

    if window_column and window_column in observations:
        window_series = observations[window_column].astype(str)
    else:
        window_series = pd.Series(DEFAULT_WINDOW, index=observations.index, dtype=str)

    ecdf_frame = pd.DataFrame({"Window": window_series, "Theta": theta})
    ecdf_frame.sort_values(["Window", "Theta"], inplace=True)

    ecdf_frame["Rank"] = ecdf_frame.groupby("Window").cumcount() + 1
    ecdf_frame["Count"] = ecdf_frame.groupby("Window")[["Theta"]].transform("count")
    ecdf_frame["Quantile"] = (ecdf_frame["Rank"] - 0.5) / ecdf_frame["Count"].clip(lower=1)

    return ecdf_frame.reset_index(drop=True)


def _ecdf_lookup(theta: float, reference: pd.DataFrame) -> float:
    values = reference["Theta"].to_numpy(dtype=float)
    if len(values) == 0:
        return 0.5
    idx = np.searchsorted(values, theta, side="right")
    return float(idx / len(values))


def _infer_coordinate_columns(frame: pd.DataFrame) -> tuple[str | None, str | None]:
    for lat, lon in (("Latitude", "Longitude"), ("Lat", "Lon")):
        if lat in frame.columns and lon in frame.columns:
            return lat, lon
    return None, None


def _knn_smooth_sparse_predictions(
    stores: pd.DataFrame,
    theta: np.ndarray,
    value: np.ndarray,
    visits: np.ndarray,
    *,
    k: int,
    smoothing_factor: float,
) -> tuple[np.ndarray, np.ndarray]:
    lat_col, lon_col = _infer_coordinate_columns(stores)
    if lat_col is None or lon_col is None:
        return theta, value

    coords = stores[[lat_col, lon_col]].to_numpy(dtype=float)
    mask_sparse = visits == 0
    mask_anchor = visits > 0

    if not mask_sparse.any() or not mask_anchor.any():
        return theta, value

    anchor_coords = coords[mask_anchor]
    anchor_theta = theta[mask_anchor]
    anchor_value = value[mask_anchor]

    smoothed_theta = theta.copy()
    smoothed_value = value.copy()

    for idx in np.where(mask_sparse)[0]:
        distances = np.sqrt(np.sum((anchor_coords - coords[idx]) ** 2, axis=1))
        if len(distances) == 0:
            continue
        neighbour_count = min(k, len(distances))
        neighbour_idx = np.argpartition(distances, neighbour_count - 1)[:neighbour_count]
        neighbour_distances = distances[neighbour_idx]
        weights = 1.0 / (neighbour_distances + 1e-6)
        weights /= weights.sum()

        theta_anchor = np.dot(anchor_theta[neighbour_idx], weights)
        value_anchor = np.dot(anchor_value[neighbour_idx], weights)

        smoothed_theta[idx] = (
            (1.0 - smoothing_factor) * smoothed_theta[idx] + smoothing_factor * theta_anchor
        )
        smoothed_value[idx] = (
            (1.0 - smoothing_factor) * smoothed_value[idx] + smoothing_factor * value_anchor
        )

    return smoothed_theta, smoothed_value


def _solve_linear_model(
    design_matrix: np.ndarray,
    response: np.ndarray,
    *,
    weights: np.ndarray | None = None,
) -> _LinearModelResult:
    response = np.asarray(response, dtype=float)
    if weights is None:
        weighted_design = design_matrix
        weighted_response = response
    else:
        weights = np.asarray(weights, dtype=float)
        root_weights = np.sqrt(np.clip(weights, 1e-6, None))
        weighted_design = design_matrix * root_weights[:, None]
        weighted_response = response * root_weights

    beta, *_ = np.linalg.lstsq(weighted_design, weighted_response, rcond=None)

    residuals = weighted_response - weighted_design @ beta
    dof = max(len(response) - design_matrix.shape[1], 1)
    dispersion = float((residuals @ residuals) / dof)

    xtx = weighted_design.T @ weighted_design
    try:
        covariance = np.linalg.inv(xtx)
    except np.linalg.LinAlgError:
        covariance = np.linalg.pinv(xtx)

    covariance *= dispersion

    return _LinearModelResult(beta=beta, covariance=covariance, dispersion=1.0)


@dataclass(slots=True)
class PosteriorPrediction:
    """Structured prediction output for a single store."""

    store_id: str
    theta: float
    yield_score: float
    value: float
    credibility: float
    method: str
    ecdf_quantile: float

    def to_dict(self) -> dict[str, float | str]:
        return {
            "StoreId": self.store_id,
            "Theta": self.theta,
            "Yield": self.yield_score,
            "Value": self.value,
            "Cred": self.credibility,
            "Method": self.method,
            "ECDF_q": self.ecdf_quantile,
        }


class PosteriorPipeline:
    """End-to-end posterior scoring pipeline."""

    def __init__(
        self,
        *,
        min_samples_glm: int = 3,
        shrinkage_strength: float = 3.0,
        knn_k: int = 3,
        knn_smoothing_factor: float = 0.5,
    ) -> None:
        self.min_samples_glm = min_samples_glm
        self.shrinkage_strength = float(shrinkage_strength)
        self.knn_k = knn_k
        self.knn_smoothing_factor = knn_smoothing_factor

        self.feature_columns_: list[str] | None = None
        self.feature_stats_: dict[str, tuple[float, float]] | None = None
        self.window_column_: str | None = None
        self.ecdf_reference_: pd.DataFrame | None = None
        self.store_summary_: pd.DataFrame | None = None
        self.yield_model_: _GLMResult | None = None
        self.value_model_: _LinearModelResult | None = None
        self.trace_records_: dict[str, TraceRecord] | None = None

    def fit(
        self,
        observations: pd.DataFrame,
        stores: pd.DataFrame,
        *,
        feature_columns: Sequence[str] | None = None,
        window_column: str | None = None,
        ecdf_cache_path: str | Path | None = None,
    ) -> PosteriorPipeline:
        """Fit posterior models from observed visits."""

        if observations.empty:
            raise ValueError("Observations frame is empty")

        stores = stores.copy()
        stores.set_index("StoreId", inplace=True, drop=False)

        features, feature_columns, feature_stats = _prepare_features(stores, feature_columns)
        self.feature_columns_ = feature_columns
        self.feature_stats_ = feature_stats

        summary = _summarise_observations(observations)
        self.store_summary_ = summary

        joined = summary.join(features[feature_columns], how="inner")
        if joined.empty:
            raise ValueError("No overlapping stores between observations and features")

        design = _design_matrix(joined, feature_columns)
        exposure = joined["exposure"].to_numpy(dtype=float)
        counts = joined["items_total"].to_numpy(dtype=float)
        offset = np.log(exposure)

        alpha = _estimate_overdispersion(joined)
        try:
            self.yield_model_ = _solve_glm(design, counts, offset=offset, alpha=alpha)
        except _GLMConvergenceError:
            # Fall back to Poisson with mild ridge when solver misbehaves.
            ridge = design.T @ design + np.eye(design.shape[1]) * 1e-6
            beta = np.linalg.solve(ridge, design.T @ (counts / exposure))
            covariance = np.linalg.pinv(design.T @ design)
            self.yield_model_ = _GLMResult(beta=beta, covariance=covariance, dispersion=1.0, family="Poisson")

        value_target = joined["value_mean"].to_numpy(dtype=float)
        value_weights = joined["visits"].to_numpy(dtype=float)

        self.value_model_ = _solve_linear_model(design, value_target, weights=value_weights)

        self.window_column_ = window_column
        ecdf_reference = _build_ecdf_reference(observations, window_column=window_column)
        self.ecdf_reference_ = ecdf_reference

        if ecdf_cache_path is not None:
            path = Path(ecdf_cache_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            ecdf_reference.to_parquet(path, index=False)

        return self

    def _design_for(self, stores: pd.DataFrame) -> np.ndarray:
        if self.feature_columns_ is None:
            raise RuntimeError("Pipeline not fitted")
        return _design_matrix(stores, self.feature_columns_)

    def _predict_theta(self, stores: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        if self.yield_model_ is None:
            raise RuntimeError("Pipeline not fitted")

        design = self._design_for(stores)
        mu, se = self.yield_model_.predict(design, offset=0.0)
        return mu, se

    def _predict_value(self, stores: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        if self.value_model_ is None:
            raise RuntimeError("Pipeline not fitted")

        design = self._design_for(stores)
        mu, se = self.value_model_.predict(design)
        return mu, se

    def _window_lookup(self, store_id: str, stores: pd.DataFrame) -> str:
        if self.window_column_ and self.window_column_ in stores.columns:
            value = stores.loc[store_id, self.window_column_]
            if pd.notna(value):
                return str(value)
        return DEFAULT_WINDOW

    def _quantile_for_theta(self, theta: float, window: str) -> float:
        if self.ecdf_reference_ is None:
            raise RuntimeError("Pipeline not fitted")

        reference = self.ecdf_reference_
        window_ref = reference[reference["Window"] == window]
        if window_ref.empty:
            window_ref = reference
        return _ecdf_lookup(theta, window_ref)

    def predict(self, stores: pd.DataFrame) -> pd.DataFrame:
        """Generate posterior predictions for the provided stores."""

        if self.store_summary_ is None:
            raise RuntimeError("Pipeline not fitted")

        stores = stores.copy()
        stores.set_index("StoreId", inplace=True, drop=False)

        raw_features = (
            stores[self.feature_columns_].copy() if self.feature_columns_ is not None else pd.DataFrame(index=stores.index)
        )

        if self.feature_columns_ is None or self.feature_stats_ is None:
            raise RuntimeError("Pipeline not fitted")

        for column in self.feature_columns_:
            mean, std = self.feature_stats_[column]
            values = stores[column].astype(float)
            stores[column] = (values - mean) / std

        theta_pred, theta_se = self._predict_theta(stores)
        value_pred, value_se = self._predict_value(stores)

        summary = self.store_summary_.reindex(stores.index).fillna(0.0)
        numeric_columns = summary.select_dtypes(include=[np.number]).columns
        summary.loc[:, numeric_columns] = summary.loc[:, numeric_columns].astype(float)

        visits = summary["visits"].to_numpy(dtype=float)
        observed_theta = summary["theta_mean"].to_numpy(dtype=float)
        observed_value = summary["value_mean"].to_numpy(dtype=float)

        methods: list[str] = []
        theta_final = np.zeros_like(theta_pred)
        value_final = np.zeros_like(value_pred)
        theta_uncertainty = np.zeros_like(theta_se)
        value_uncertainty = np.zeros_like(value_se)

        for idx, store_id in enumerate(stores.index):
            visit_count = visits[idx]
            base_theta = theta_pred[idx]
            base_value = value_pred[idx]
            se_theta = theta_se[idx]
            se_value = value_se[idx]

            if visit_count >= self.min_samples_glm:
                methods.append("GLM")
                if np.isfinite(observed_theta[idx]) and observed_theta[idx] > 0.0:
                    theta_final[idx] = observed_theta[idx]
                else:
                    theta_final[idx] = base_theta
                if np.isfinite(observed_value[idx]):
                    value_final[idx] = observed_value[idx]
                else:
                    value_final[idx] = base_value
                theta_uncertainty[idx] = se_theta
                value_uncertainty[idx] = se_value
            elif visit_count > 0:
                methods.append("Hier")
                theta_final[idx] = observed_theta[idx]
                value_final[idx] = observed_value[idx]
                theta_uncertainty[idx] = se_theta
                value_uncertainty[idx] = se_value
            else:
                methods.append("kNN")
                theta_final[idx] = base_theta
                value_final[idx] = base_value
                theta_uncertainty[idx] = se_theta
                value_uncertainty[idx] = se_value

        theta_before_knn = theta_final.copy()
        value_before_knn = value_final.copy()

        if "kNN" in methods:
            theta_final, value_final = _knn_smooth_sparse_predictions(
                stores,
                theta_final,
                value_final,
                visits,
                k=self.knn_k,
                smoothing_factor=self.knn_smoothing_factor,
            )
        theta_adjacency = theta_final - theta_before_knn
        value_adjacency = value_final - value_before_knn

        # Map theta to the 1–5 Yield scale via the persisted ECDF.
        quantiles = []
        yield_scores = []
        for idx, store_id in enumerate(stores.index):
            window = self._window_lookup(store_id, stores)
            quantile = self._quantile_for_theta(theta_final[idx], window)
            quantiles.append(quantile)
            yield_scores.append(clamp_score(1.0 + 4.0 * quantile))

        value_final = np.clip(value_final, 1.0, 5.0)

        # Credibility uses normalised uncertainty (lower SE → higher credibility).
        se_normalised = np.clip(theta_uncertainty / (theta_final + 1e-6), 0.0, None)
        value_component = np.clip(value_uncertainty / 2.0, 0.0, None)
        credibility = 1.0 / (1.0 + se_normalised + value_component)
        credibility = np.clip(credibility, 0.0, 1.0)

        for idx, method in enumerate(methods):
            if method == "kNN":
                credibility[idx] *= 0.8

        model_payload = {
            "feature_columns": self.feature_columns_,
            "min_samples_glm": self.min_samples_glm,
            "knn_k": self.knn_k,
            "knn_smoothing_factor": self.knn_smoothing_factor,
        }

        if self.yield_model_ is not None:
            model_payload["yield_beta"] = self.yield_model_.beta.tolist()
            model_payload["yield_family"] = self.yield_model_.family
        if self.value_model_ is not None:
            model_payload["value_beta"] = self.value_model_.beta.tolist()

        parameter_hash = hash_payload(model_payload)

        traces: dict[str, TraceRecord] = {}

        predictions = [
            PosteriorPrediction(
                store_id=str(store_id),
                theta=float(theta_final[idx]),
                yield_score=float(yield_scores[idx]),
                value=float(value_final[idx]),
                credibility=float(credibility[idx]),
                method=methods[idx],
                ecdf_quantile=float(quantiles[idx]),
            ).to_dict()
            for idx, store_id in enumerate(stores.index)
        ]

        for idx, store_id in enumerate(stores.index):
            summary_row = summary.iloc[idx]
            observations_section = {
                "visits": float(summary_row.get("visits", 0.0)),
                "dwell_total": float(summary_row.get("dwell_total", 0.0)),
                "items_total": float(summary_row.get("items_total", 0.0)),
                "value_mean": float(summary_row.get("value_mean", 0.0)),
                "theta_observed": float(summary_row.get("theta_mean", 0.0)),
                "method": methods[idx],
                "theta_uncertainty": float(theta_se[idx]),
                "value_uncertainty": float(value_se[idx]),
            }

            baseline_section = {
                "theta_prediction": float(theta_pred[idx]),
                "value_prediction": float(value_pred[idx]),
            }

            adjacency_section = {
                "theta": float(theta_adjacency[idx]),
                "value": float(value_adjacency[idx]),
            }

            affluence_section: dict[str, float] = {}
            if not raw_features.empty:
                for column in raw_features.columns:
                    affluence_section[column] = float(raw_features.iloc[idx][column])

            scores_section = {
                "theta_final": float(theta_final[idx]),
                "yield_final": float(yield_scores[idx]),
                "value_final": float(value_final[idx]),
                "credibility": float(credibility[idx]),
                "ecdf_quantile": float(quantiles[idx]),
            }

            model_section = {
                "parameters_hash": parameter_hash,
                "yield_family": self.yield_model_.family if self.yield_model_ else None,
                "min_samples_glm": self.min_samples_glm,
                "knn_k": self.knn_k,
                "knn_smoothing_factor": self.knn_smoothing_factor,
            }

            traces[str(store_id)] = TraceRecord(
                store_id=str(store_id),
                stage="posterior",
                baseline=baseline_section,
                affluence=affluence_section,
                adjacency=adjacency_section,
                observations=observations_section,
                model=model_section,
                scores=scores_section,
            )

        self.trace_records_ = traces

        return pd.DataFrame(predictions)

    def iter_traces(self) -> Iterator[dict[str, object]]:
        """Yield flattened trace payloads for the most recent predictions."""

        traces = self.trace_records_ or {}
        for store_id, record in traces.items():
            payload = record.to_dict()
            payload.setdefault("store_id", str(store_id))
            yield payload

    def trace_records_frame(self) -> pd.DataFrame:
        """Return trace payloads as a :class:`pandas.DataFrame`."""

        rows = list(self.iter_traces())
        if not rows:
            return pd.DataFrame()
        return pd.DataFrame(rows)


__all__ = [
    "PosteriorPipeline",
    "PosteriorPrediction",
]

