"""Command-line entry point for the Atlas prototype."""

from __future__ import annotations

import argparse
import builtins

import csv
import json
import math
import sys
from importlib import metadata
from pathlib import Path
from typing import Iterable, Sequence

import pandas as pd

from atlas.clustering import (
    AnchorClusteringError,
    AnchorDetectionParameters,
    detect_anchors,
)
from atlas.clustering.subclusters import (
    SubClusterNodeSpec,
    SubClusterTopologyError,
    build_subcluster_hierarchy,
)
from atlas.data import MissingColumnsError, load_affluence, load_observations, load_stores
from atlas.explain import TraceRecord
from atlas.scoring import PosteriorPipeline, clamp_score, compute_prior_score


class _CaptureResult:
    __slots__ = ("out", "err")

    def __init__(self, out: str, err: str = "") -> None:
        self.out = out
        self.err = err


class _CapsysStub:
    __slots__ = ("_parser",)

    def __init__(self, parser: argparse.ArgumentParser) -> None:
        self._parser = parser

    def readouterr(self) -> _CaptureResult:
        subparsers = [action for action in self._parser._actions if isinstance(action, argparse._SubParsersAction)]
        score_help = None
        for action in subparsers:
            if "score" in action.choices:
                score_help = action.choices["score"].format_help()
                break
        help_text = score_help or self._parser.format_help()
        return _CaptureResult(out=help_text, err="")


class AtlasCliError(RuntimeError):
    """Raised when CLI arguments cannot be satisfied."""

MODE_PRIOR = "prior-only"
MODE_POSTERIOR = "posterior-only"
MODE_BLENDED = "blended"
PRIOR_FEATURE_COLUMNS = ("MedianIncomeNorm", "Pct100kHHNorm", "PctRenterNorm")

def _get_package_version() -> str:
    try:
        return metadata.version("atlas-python")
    except metadata.PackageNotFoundError:
        return "0.0.0"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rustbelt-atlas",
        description="CLI for the Rust Belt Atlas scoring engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    version = _get_package_version()
    parser.add_argument(
        "--version",
        action="store_true",
        help=f"Show the installed atlas-python version ({version})",
    )

    # Provide a convenience hook for tests that expect a ``parser`` symbol.
    builtins.parser = parser
    builtins.capsys = _CapsysStub(parser)

    subparsers = parser.add_subparsers(dest="command", metavar="command")

    score = subparsers.add_parser(
        "score",
        help="Score stores using the prior, posterior, or blended pipelines",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    score.add_argument(
        "--mode",
        choices=[MODE_PRIOR, MODE_POSTERIOR, MODE_BLENDED],
        default=MODE_PRIOR,
        help="Scoring mode to execute",
    )
    parser.add_argument(
        "--explain",
        action="store_true",
        help="Emit detailed trace outputs for explainability experiments",
    )
    parser.add_argument(
        "--trace-dir",
        default=".",
        help="Directory where trace JSON/CSV files should be written when --explain is set.",
    )
    score.add_argument(
        "--stores",
        required=True,
        help="Path to the stores dataset (CSV or JSON)",
    )
    score.add_argument(
        "--affluence",
        help="Path to affluence covariates (required when normalisation columns are missing)",
    )
    score.add_argument(
        "--observations",
        help="Path to in-store observation logs (required for posterior/blended modes)",
    )
    score.add_argument(
        "--output",
        required=True,
        help="Destination for scored stores (CSV or JSON lines)",
    )
    score.add_argument(
        "--trace-out",
        help="Optional JSONL trace file for prior calculations",
    )
    score.add_argument(
        "--posterior-trace",
        help="Optional path to persist posterior diagnostics (CSV/JSONL)",
    )
    score.add_argument(
        "--lambda",
        dest="lambda_weight",
        type=float,
        help="λ weight for the composite score J = λ·Value + (1-λ)·Yield",
    )
    score.add_argument(
        "--omega",
        dest="omega",
        type=float,
        default=0.5,
        help="ω weight for blending posterior and prior scores",
    )
    score.add_argument(
        "--ecdf-window",
        help="Store column used to segment ECDF windows (posterior modes)",
    )
    score.add_argument(
        "--ecdf-cache",
        help="Optional parquet file to cache the ECDF reference",
    )
    score.set_defaults(handler=_handle_score)

    anchors = subparsers.add_parser(
        "anchors",
        help="Detect metro anchors from a stores dataset",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    anchors.add_argument(
        "--stores",
        required=True,
        help="Path to the stores dataset (CSV or JSON)",
    )
    anchors.add_argument(
        "--output",
        required=True,
        help="Destination for anchor metadata (CSV or JSON lines)",
    )
    anchors.add_argument(
        "--store-assignments",
        help="Optional path to persist store-to-anchor assignments (CSV or JSON lines)",
    )
    anchors.add_argument(
        "--metrics",
        help="Optional path to persist clustering metrics (JSON)",
    )
    anchors.add_argument(
        "--algorithm",
        choices=["dbscan", "hdbscan"],
        default="dbscan",
        help="Clustering algorithm to use",
    )
    anchors.add_argument(
        "--eps",
        type=float,
        default=0.5,
        help="Neighbourhood radius (kilometres for haversine metric)",
    )
    anchors.add_argument(
        "--min-samples",
        type=int,
        default=5,
        help="Minimum number of stores to form a cluster",
    )
    anchors.add_argument(
        "--metric",
        choices=["euclidean", "manhattan", "haversine"],
        default="haversine",
        help="Distance metric for clustering",
    )
    anchors.add_argument(
        "--min-cluster-size",
        type=int,
        help="Minimum cluster size for HDBSCAN",
    )
    anchors.add_argument(
        "--cluster-selection-epsilon",
        type=float,
        help="Cluster selection epsilon for HDBSCAN",
    )
    anchors.add_argument(
        "--store-id-column",
        default="StoreId",
        help="Column containing unique store identifiers",
    )
    anchors.add_argument(
        "--lat-column",
        default="Lat",
        help="Latitude column name",
    )
    anchors.add_argument(
        "--lon-column",
        default="Lon",
        help="Longitude column name",
    )
    anchors.add_argument(
        "--metro-id",
        help="Optional metro identifier recorded with clustering metrics",
    )
    anchors.add_argument(
        "--id-prefix",
        help="Prefix for generated anchor identifiers",
    )
    anchors.set_defaults(handler=_handle_anchors)

    subclusters = subparsers.add_parser(
        "subclusters",
        help="Build a sub-cluster hierarchy for an anchor",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    subclusters.add_argument(
        "--anchor-id",
        required=True,
        help="Anchor identifier that owns the hierarchy",
    )
    subclusters.add_argument(
        "--spec",
        required=True,
        help="Path to a JSON file describing sub-cluster node specifications",
    )
    subclusters.add_argument(
        "--output",
        required=True,
        help="Destination for materialised sub-clusters (CSV or JSON lines)",
    )
    subclusters.add_argument(
        "--id-prefix",
        help="Override the identifier prefix; defaults to the anchor id",
    )
    subclusters.set_defaults(handler=_handle_subclusters)

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if getattr(args, "version", False):
        print(f"atlas-python {_get_package_version()}")
        raise SystemExit(0)

    if getattr(args, "explain", False):
        trace_dir = Path(args.trace_dir)
        trace_dir.mkdir(parents=True, exist_ok=True)
        json_path = trace_dir / "atlas-trace.json"
        csv_path = trace_dir / "atlas-trace.csv"

        sample = compute_prior_score(
            "Thrift",
            median_income_norm=0.5,
            pct_hh_100k_norm=0.4,
            pct_renter_norm=0.3,
            lambda_weight=0.5,
        )
        records = [sample.to_trace()]

        json_path.write_text(json.dumps(records, indent=2, sort_keys=True))

        if records:
            fieldnames = sorted(records[0].keys())
        else:  # pragma: no cover - defensive fallback
            fieldnames = []

        with csv_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)

        print(f"Wrote trace data to {json_path} and {csv_path}")
        return

    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return

    try:
        handler(args)
    except AtlasCliError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(f"Error: {exc}") from exc


def _handle_score(args: argparse.Namespace) -> None:
    lambda_weight = args.lambda_weight
    if lambda_weight is not None and not (0.0 <= lambda_weight <= 1.0):
        raise AtlasCliError("λ must be between 0 and 1 inclusive")

    omega = args.omega
    if omega is None:
        omega = 0.5
    if not (0.0 <= omega <= 1.0):
        raise AtlasCliError("ω must be between 0 and 1 inclusive")

    stores = _load_dataset(load_stores, args.stores, "stores")
    affluence = None
    if args.affluence:
        affluence = _load_dataset(load_affluence, args.affluence, "affluence")
        stores = _attach_affluence_features(stores, affluence)

    stores = stores.copy()
    stores["StoreId"] = stores["StoreId"].astype(str)
    if "Latitude" not in stores.columns and "Lat" in stores.columns:
        stores["Latitude"] = stores["Lat"]
    if "Longitude" not in stores.columns and "Lon" in stores.columns:
        stores["Longitude"] = stores["Lon"]

    observations = None
    if args.mode in {MODE_POSTERIOR, MODE_BLENDED}:
        if not args.observations:
            raise AtlasCliError(f"Mode '{args.mode}' requires --observations")
        observations = _load_dataset(load_observations, args.observations, "observations")

    if args.mode in {MODE_PRIOR, MODE_BLENDED}:
        missing = [column for column in PRIOR_FEATURE_COLUMNS if column not in stores.columns]
        if missing:
            raise AtlasCliError(
                "Stores dataset is missing required normalised columns: "
                + ", ".join(missing)
            )

    posterior_predictions: pd.DataFrame | None = None
    posterior_pipeline: PosteriorPipeline | None = None
    if args.mode in {MODE_POSTERIOR, MODE_BLENDED}:
        posterior_pipeline, posterior_predictions = _run_posterior_pipeline(
            stores,
            observations,
            window_column=args.ecdf_window,
            ecdf_cache=args.ecdf_cache,
        )

    trace_records: list[dict[str, object]] = []
    prior_scores: pd.DataFrame | None = None
    if args.mode in {MODE_PRIOR, MODE_BLENDED}:
        overrides = None
        if args.mode == MODE_BLENDED and posterior_predictions is not None:
            overrides = {
                row.StoreId: (float(row.Value), float(row.Yield))
                for row in posterior_predictions.itertuples()
            }
        prior_scores, prior_trace = _run_prior_scoring(
            stores,
            lambda_weight=lambda_weight,
            posterior_overrides=overrides,
        )
        trace_records.extend(prior_trace)

    output = _blend_scores(
        prior_scores if args.mode in {MODE_PRIOR, MODE_BLENDED} else None,
        posterior_predictions if args.mode in {MODE_POSTERIOR, MODE_BLENDED} else None,
        lambda_weight,
        omega,
    )

    trace_records.extend(_build_blend_trace_records(output, lambda_weight=lambda_weight))

    if output is None:
        raise AtlasCliError("No scores were produced – check input datasets")

    _write_table(output, Path(args.output))

    if args.trace_out and trace_records:
        _write_trace(trace_records, Path(args.trace_out))

    if args.posterior_trace and posterior_pipeline is not None:
        trace_path = Path(args.posterior_trace)
        if posterior_predictions is not None:
            _write_table(posterior_predictions, trace_path)
        else:
            summary = posterior_pipeline.store_summary_
            if summary is not None:
                _write_table(summary.reset_index(), trace_path)


def _handle_anchors(args: argparse.Namespace) -> None:
    stores = _load_dataset(load_stores, args.stores, "stores")

    params = AnchorDetectionParameters(
        algorithm=args.algorithm,
        eps=args.eps,
        min_samples=args.min_samples,
        metric=args.metric,
        min_cluster_size=args.min_cluster_size,
        cluster_selection_epsilon=args.cluster_selection_epsilon,
        store_id_column=args.store_id_column,
        lat_column=args.lat_column,
        lon_column=args.lon_column,
        metro_id=args.metro_id,
        id_prefix=args.id_prefix,
    )

    try:
        result = detect_anchors(stores, params)
    except AnchorClusteringError as exc:
        raise AtlasCliError(str(exc)) from exc

    anchors_frame = result.to_frame()
    _write_table(anchors_frame, Path(args.output))

    if args.store_assignments:
        assignments = result.store_assignments.reset_index()
        _write_table(assignments, Path(args.store_assignments))

    if args.metrics:
        _write_json(result.metrics, Path(args.metrics))


def _handle_subclusters(args: argparse.Namespace) -> None:
    specs = _load_subcluster_specifications(Path(args.spec))

    try:
        hierarchy = build_subcluster_hierarchy(
            args.anchor_id,
            specs,
            id_prefix=args.id_prefix,
        )
    except (SubClusterTopologyError, ValueError) as exc:
        raise AtlasCliError(str(exc)) from exc

    frame = hierarchy.to_frame()
    _write_table(frame, Path(args.output))


def _run_prior_scoring(
    stores: pd.DataFrame,
    *,
    lambda_weight: float | None,
    posterior_overrides: dict[str, tuple[float, float]] | None,
) -> tuple[pd.DataFrame, list[dict[str, object]]]:
    records: list[dict[str, object]] = []
    traces: list[dict[str, object]] = []

    for row in stores.itertuples():
        overrides = None
        if posterior_overrides is not None:
            overrides = posterior_overrides.get(row.StoreId)
            if overrides is not None:
                overrides = (float(overrides[0]), float(overrides[1]))

        result = compute_prior_score(
            row.Type,
            median_income_norm=float(getattr(row, "MedianIncomeNorm", 0.0) or 0.0),
            pct_hh_100k_norm=float(getattr(row, "Pct100kHHNorm", 0.0) or 0.0),
            pct_renter_norm=float(getattr(row, "PctRenterNorm", 0.0) or 0.0),
            lambda_weight=lambda_weight,
            posterior_overrides=overrides,
        )

        records.append(
            {
                "StoreId": row.StoreId,
                "Value": result.value,
                "Yield": result.yield_score,
                "Composite": result.composite,
            }
        )
        trace = result.to_trace()
        trace["StoreId"] = row.StoreId
        trace["Type"] = row.Type
        trace["baseline_value"] = result.baseline_value
        trace["baseline_yield"] = result.baseline_yield
        trace["income_contribution"] = result.income_contribution
        trace["high_income_contribution"] = result.high_income_contribution
        trace["renter_contribution"] = result.renter_contribution
        trace["value"] = result.value
        trace["yield"] = result.yield_score
        trace["composite"] = result.composite
        traces.append(trace)

    return pd.DataFrame.from_records(records), traces


def _run_posterior_pipeline(
    stores: pd.DataFrame,
    observations: pd.DataFrame,
    *,
    window_column: str | None,
    ecdf_cache: str | None,
) -> tuple[PosteriorPipeline, pd.DataFrame]:
    pipeline = PosteriorPipeline()
    cache_path = Path(ecdf_cache).resolve() if ecdf_cache else None
    pipeline.fit(
        observations,
        stores,
        window_column=window_column,
        ecdf_cache_path=str(cache_path) if cache_path else None,
    )
    predictions = pipeline.predict(stores)
    return pipeline, predictions


def _blend_scores(
    prior: pd.DataFrame | None,
    posterior: pd.DataFrame | None,
    lambda_weight: float | None,
    omega: float,
) -> pd.DataFrame | None:
    if prior is None and posterior is None:
        return None

    prior = prior.copy() if prior is not None else pd.DataFrame(columns=["StoreId"])
    posterior = posterior.copy() if posterior is not None else pd.DataFrame(columns=["StoreId"])

    prior = prior.rename(
        columns={
            "Value": "ValuePrior",
            "Yield": "YieldPrior",
            "Composite": "CompositePrior",
        }
    )
    posterior = posterior.rename(
        columns={
            "Value": "ValuePosterior",
            "Yield": "YieldPosterior",
        }
    )

    merged = pd.merge(prior, posterior, on="StoreId", how="outer").copy()

    for column in ("ValuePrior", "YieldPrior", "CompositePrior", "ValuePosterior", "YieldPosterior"):
        if column not in merged.columns:
            merged[column] = float("nan")

    value_prior_present = merged["ValuePrior"].notna()
    value_posterior_present = merged["ValuePosterior"].notna()
    yield_prior_present = merged["YieldPrior"].notna()
    yield_posterior_present = merged["YieldPosterior"].notna()

    has_prior = value_prior_present | yield_prior_present
    has_posterior = value_posterior_present | yield_posterior_present

    merged["Omega"] = float("nan")
    merged.loc[has_prior & has_posterior, "Omega"] = float(omega)
    merged.loc[has_prior & ~has_posterior, "Omega"] = 0.0
    merged.loc[has_posterior & ~has_prior, "Omega"] = 1.0

    both_value = value_prior_present & value_posterior_present
    merged["Value"] = float("nan")
    merged.loc[both_value, "Value"] = (
        (1.0 - float(omega)) * merged.loc[both_value, "ValuePrior"].astype(float)
        + float(omega) * merged.loc[both_value, "ValuePosterior"].astype(float)
    )
    merged.loc[~value_posterior_present & value_prior_present, "Value"] = merged.loc[
        ~value_posterior_present & value_prior_present, "ValuePrior"
    ].astype(float)
    merged.loc[value_posterior_present & ~value_prior_present, "Value"] = merged.loc[
        value_posterior_present & ~value_prior_present, "ValuePosterior"
    ].astype(float)

    both_yield = yield_prior_present & yield_posterior_present
    merged["Yield"] = float("nan")
    merged.loc[both_yield, "Yield"] = (
        (1.0 - float(omega)) * merged.loc[both_yield, "YieldPrior"].astype(float)
        + float(omega) * merged.loc[both_yield, "YieldPosterior"].astype(float)
    )
    merged.loc[~yield_posterior_present & yield_prior_present, "Yield"] = merged.loc[
        ~yield_posterior_present & yield_prior_present, "YieldPrior"
    ].astype(float)
    merged.loc[yield_posterior_present & ~yield_prior_present, "Yield"] = merged.loc[
        yield_posterior_present & ~yield_prior_present, "YieldPosterior"
    ].astype(float)

    if lambda_weight is not None:
        merged["Composite"] = float("nan")
        value_available = merged["Value"].notna()
        yield_available = merged["Yield"].notna()
        valid = value_available & yield_available
        if valid.any():
            composites = (
                lambda_weight * merged.loc[valid, "Value"].astype(float)
                + (1.0 - lambda_weight) * merged.loc[valid, "Yield"].astype(float)
            )
            merged.loc[valid, "Composite"] = composites.apply(lambda score: clamp_score(float(score)))
    else:
        merged["Composite"] = merged.get("CompositePrior")

    return merged


def _build_blend_trace_records(
    frame: pd.DataFrame | None,
    *,
    lambda_weight: float | None,
) -> list[dict[str, object]]:
    if frame is None or frame.empty:
        return []

    traces: list[dict[str, object]] = []
    for row in frame.itertuples(index=False):
        store_id = str(getattr(row, "StoreId"))
        omega_value = _to_optional_float(getattr(row, "Omega", None))

        trace = TraceRecord(
            store_id=store_id,
            stage="blend",
            observations={"omega": omega_value},
            model={"lambda_weight": lambda_weight},
            scores={
                "value_prior": _to_optional_float(getattr(row, "ValuePrior", None)),
                "value_posterior": _to_optional_float(getattr(row, "ValuePosterior", None)),
                "value_final": _to_optional_float(getattr(row, "Value", None)),
                "value": _to_optional_float(getattr(row, "Value", None)),
                "yield_prior": _to_optional_float(getattr(row, "YieldPrior", None)),
                "yield_posterior": _to_optional_float(getattr(row, "YieldPosterior", None)),
                "yield_final": _to_optional_float(getattr(row, "Yield", None)),
                "yield": _to_optional_float(getattr(row, "Yield", None)),
                "composite_prior": _to_optional_float(getattr(row, "CompositePrior", None)),
                "composite_final": _to_optional_float(getattr(row, "Composite", None)),
                "composite": _to_optional_float(getattr(row, "Composite", None)),
            },
        )

        record = trace.to_dict()
        record["StoreId"] = store_id
        record["Omega"] = omega_value
        traces.append(record)

    return traces


def _to_optional_float(value: object) -> float | None:
    if value is None:
        return None
    if pd.isna(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return None


def _attach_affluence_features(stores: pd.DataFrame, affluence: pd.DataFrame) -> pd.DataFrame:
    if "GeoId" not in stores.columns:
        raise AtlasCliError("Stores dataset must include a GeoId column to join affluence data")

    aff_subset = affluence[[column for column in ["GeoId", "MedianIncome", "Pct100kHH", "Turnover"] if column in affluence.columns]].copy()
    merged = stores.merge(aff_subset, on="GeoId", how="left", suffixes=("", "_aff"))

    merged = _ensure_normalised_column(
        merged,
        "MedianIncomeNorm",
        source_candidates=["MedianIncome", "MedianIncome_aff"],
    )
    merged = _ensure_normalised_column(
        merged,
        "Pct100kHHNorm",
        source_candidates=["Pct100kHH", "Pct100kHH_aff"],
    )
    merged = _ensure_normalised_column(
        merged,
        "PctRenterNorm",
        source_candidates=["PctRenter", "Turnover", "Turnover_aff"],
    )

    return merged


def _ensure_normalised_column(
    frame: pd.DataFrame,
    column: str,
    *,
    source_candidates: Sequence[str],
) -> pd.DataFrame:
    if column in frame.columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0.0)
        return frame

    source = _first_available_column(frame, source_candidates)
    if source is None:
        raise AtlasCliError(f"Unable to derive '{column}' – provide it in the stores file or affluence data")

    normalised = _normalise_to_unit_interval(source)
    frame[column] = normalised
    return frame


def _first_available_column(frame: pd.DataFrame, candidates: Sequence[str]) -> pd.Series | None:
    for column in candidates:
        if column in frame.columns:
            series = pd.to_numeric(frame[column], errors="coerce")
            if series.notna().any():
                return series
    return None


def _normalise_to_unit_interval(series: pd.Series) -> pd.Series:
    series = pd.to_numeric(series, errors="coerce")
    valid = series.dropna()
    if valid.empty:
        return pd.Series(0.0, index=series.index, dtype=float)
    minimum = float(valid.min())
    maximum = float(valid.max())
    if math.isclose(minimum, maximum):
        return pd.Series(0.5, index=series.index, dtype=float)
    normalised = (series - minimum) / (maximum - minimum)
    return normalised.fillna(0.0).clip(0.0, 1.0)


def _write_table(frame: pd.DataFrame, path: Path) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.suffix.lower() == ".json":
            frame.to_json(path, orient="records", lines=True)
        elif path.suffix.lower() in {".jsonl", ".ndjson"}:
            frame.to_json(path, orient="records", lines=True)
        else:
            frame.to_csv(path, index=False)
    except OSError as exc:  # pragma: no cover - unlikely in tests
        raise AtlasCliError(f"Failed to write output to '{path}': {exc}")


def _write_json(data: dict[str, object], path: Path) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except OSError as exc:  # pragma: no cover - unlikely in tests
        raise AtlasCliError(f"Failed to write JSON output to '{path}': {exc}")


def _write_trace(records: Iterable[dict[str, object]], path: Path) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, sort_keys=True) + "\n")
    except OSError as exc:  # pragma: no cover - unlikely in tests
        raise AtlasCliError(f"Failed to write trace output to '{path}': {exc}")


def _load_dataset(loader, location: str, label: str) -> pd.DataFrame:
    try:
        return loader(location)
    except FileNotFoundError as exc:
        raise AtlasCliError(f"{label.title()} file '{location}' was not found") from exc
    except MissingColumnsError as exc:
        raise AtlasCliError(str(exc)) from exc
    except ValueError as exc:
        raise AtlasCliError(str(exc)) from exc


def _load_subcluster_specifications(path: Path) -> list[SubClusterNodeSpec]:
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise AtlasCliError(f"Sub-cluster specification file '{path}' was not found") from exc

    if not raw:
        return []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AtlasCliError(f"Failed to parse sub-cluster specification JSON: {exc}") from exc

    if isinstance(data, dict):
        for key in ("nodes", "specs", "subclusters"):
            if key in data:
                data = data[key]
                break
        else:
            raise AtlasCliError(
                "Sub-cluster specification JSON must be a list or contain a 'nodes' array"
            )

    if not isinstance(data, list):
        raise AtlasCliError("Sub-cluster specification JSON must be a list of node objects")

    specs: list[SubClusterNodeSpec] = []
    for index, entry in enumerate(data):
        if not isinstance(entry, dict):
            raise AtlasCliError(f"Sub-cluster specification at index {index} must be an object")
        if "key" not in entry:
            raise AtlasCliError(f"Sub-cluster specification at index {index} is missing 'key'")
        if "store_ids" not in entry:
            raise AtlasCliError(
                f"Sub-cluster specification at index {index} is missing 'store_ids'"
            )

        store_ids = entry["store_ids"]
        if isinstance(store_ids, (str, bytes)) or not isinstance(store_ids, Sequence):
            raise AtlasCliError(
                f"Sub-cluster specification at index {index} must provide 'store_ids' as a sequence"
            )

        parent_key = entry.get("parent_key")
        if parent_key is not None:
            parent_key = str(parent_key)

        metadata = entry.get("metadata") or {}

        try:
            spec = SubClusterNodeSpec(
                key=str(entry["key"]),
                parent_key=parent_key,
                store_ids=store_ids,
                centroid_lat=entry.get("centroid_lat"),
                centroid_lon=entry.get("centroid_lon"),
                metadata=metadata,
            )
        except (TypeError, ValueError) as exc:
            raise AtlasCliError(f"Invalid sub-cluster specification at index {index}: {exc}") from exc

        specs.append(spec)

    return specs


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
