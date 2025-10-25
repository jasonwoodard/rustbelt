#!/usr/bin/env python3
"""Regenerate dense urban Atlas fixtures consumed by Solver regression tests."""

from __future__ import annotations

import csv
import json
import shlex
import sys
from pathlib import Path
from typing import Iterable, Sequence


THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parents[2]
ATLAS_SRC = REPO_ROOT / 'packages' / 'atlas-python' / 'src'
if str(ATLAS_SRC) not in sys.path:
    sys.path.insert(0, str(ATLAS_SRC))

from atlas.cli.__main__ import main as atlas_cli_main  # noqa: E402
from atlas.diagnostics import DIAGNOSTICS_BASENAME  # noqa: E402


ATLAS_FIXTURE_DIR = ATLAS_SRC / 'atlas' / 'fixtures' / 'dense_urban'
SCORES_PATH = THIS_DIR / 'dense-urban-scores.csv'
TRACE_PATH = THIS_DIR / 'dense-urban-trace.jsonl'
POSTERIOR_TRACE_PATH = THIS_DIR / 'dense-urban-posterior-trace.csv'
DIAGNOSTICS_DIR = THIS_DIR
ANCHORS_PATH = THIS_DIR / 'dense-urban-anchors.csv'
ANCHOR_ASSIGNMENTS_PATH = THIS_DIR / 'dense-urban-anchor-assignments.csv'
ANCHOR_METRICS_PATH = THIS_DIR / 'dense-urban-anchor-metrics.json'
SUBCLUSTER_SPEC_PATH = THIS_DIR / 'dense-urban-subcluster-spec.json'
SUBCLUSTERS_PATH = THIS_DIR / 'dense-urban-subclusters.jsonl'
TRIP_OUTPUT_PATH = THIS_DIR / 'dense-urban-trip.json'


def _load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding='utf-8') as handle:
        return list(csv.DictReader(handle))


def _run_atlas_cli(args: Sequence[str]) -> None:
    command = ' '.join(shlex.quote(part) for part in ('atlas.cli', *args))
    print(f'Running {command}')
    try:
        atlas_cli_main(list(args))
    except SystemExit as exc:  # pragma: no cover - defensive guard
        code = exc.code or 0
        if code != 0:
            raise RuntimeError(f'Command `{command}` failed with exit code {code}') from exc


def _regenerate_scores_and_sidecars() -> None:
    _run_atlas_cli(
        (
            'score',
            '--mode',
            'blended',
            '--stores',
            str(ATLAS_FIXTURE_DIR / 'stores.csv'),
            '--affluence',
            str(ATLAS_FIXTURE_DIR / 'affluence.csv'),
            '--observations',
            str(ATLAS_FIXTURE_DIR / 'observations.csv'),
            '--output',
            str(SCORES_PATH),
            '--lambda',
            '0.5',
            '--trace-out',
            str(TRACE_PATH),
            '--trace-format',
            'jsonl',
            '--posterior-trace',
            str(POSTERIOR_TRACE_PATH),
            '--posterior-trace-format',
            'csv',
            '--diagnostics-dir',
            str(DIAGNOSTICS_DIR),
        )
    )


def _regenerate_anchors() -> None:
    _run_atlas_cli(
        (
            'anchors',
            '--stores',
            str(ATLAS_FIXTURE_DIR / 'stores.csv'),
            '--output',
            str(ANCHORS_PATH),
            '--store-assignments',
            str(ANCHOR_ASSIGNMENTS_PATH),
            '--metrics',
            str(ANCHOR_METRICS_PATH),
            '--algorithm',
            'dbscan',
            '--eps',
            '0.03',
            '--min-samples',
            '2',
            '--metric',
            'euclidean',
            '--id-prefix',
            'metro-anchor',
        )
    )


def _regenerate_subclusters() -> None:
    _run_atlas_cli(
        (
            'subclusters',
            '--anchor-id',
            'metro-anchor-001',
            '--spec',
            str(SUBCLUSTER_SPEC_PATH),
            '--output',
            str(SUBCLUSTERS_PATH),
            '--id-prefix',
            'metro-anchor-001-sc',
        )
    )


def _regenerate_trip() -> None:
    stores_rows = _load_csv(ATLAS_FIXTURE_DIR / 'stores.csv')
    score_rows = {row['StoreId']: row for row in _load_csv(SCORES_PATH)}

    store_payload: list[dict[str, object]] = []
    for row in stores_rows:
        store_id = row['StoreId']
        payload: dict[str, object] = {
            'id': store_id,
            'name': row['Name'],
            'lat': float(row['Lat']),
            'lon': float(row['Lon']),
            'dayId': 'D1',
            'dwellMin': 15,
        }
        score = score_rows.get(store_id, {}).get('Composite')
        if score:
            payload['score'] = float(score)
        store_payload.append(payload)

    trip = {
        'config': {
            'mph': 28,
            'defaultDwellMin': 12,
            'seed': 2024,
            'runNote': 'atlas-regression-dense-urban',
        },
        'days': [
            {
                'dayId': 'D1',
                'start': {'id': 'DU-START', 'name': 'Downtown Depot', 'lat': 42.331, 'lon': -83.045},
                'end': {'id': 'DU-END', 'name': 'Warehouse Return', 'lat': 42.389, 'lon': -83.02},
                'window': {'start': '08:00', 'end': '18:00'},
                'dayOfWeek': 'Wed',
                'mustVisitIds': ['DU-001'],
            }
        ],
        'stores': store_payload,
    }

    TRIP_OUTPUT_PATH.write_text(json.dumps(trip, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {TRIP_OUTPUT_PATH.relative_to(REPO_ROOT)}')


def main() -> None:
    """Run the Atlas CLI to refresh score, trace, anchor, and trip fixtures."""

    _regenerate_scores_and_sidecars()
    _regenerate_anchors()
    _regenerate_subclusters()
    _regenerate_trip()

    diagnostics_outputs: Iterable[Path] = (
        DIAGNOSTICS_DIR / f'{DIAGNOSTICS_BASENAME}.json',
        DIAGNOSTICS_DIR / f'{DIAGNOSTICS_BASENAME}.html',
        DIAGNOSTICS_DIR / f'{DIAGNOSTICS_BASENAME}.parquet',
    )
    for path in diagnostics_outputs:
        if path.exists():
            print(f'Wrote {path.relative_to(REPO_ROOT)}')


if __name__ == '__main__':
    main()
