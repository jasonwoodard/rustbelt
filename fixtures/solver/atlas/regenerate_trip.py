#!/usr/bin/env python3
"""Regenerate the dense urban Solver trip from Atlas fixtures."""

from __future__ import annotations

import csv
import json
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parents[3]
ATLAS_FIXTURE_DIR = REPO_ROOT / 'packages' / 'atlas-python' / 'src' / 'atlas' / 'fixtures' / 'dense_urban'
SCORES_PATH = THIS_DIR / 'dense-urban-scores.csv'
OUTPUT_PATH = THIS_DIR / 'dense-urban-trip.json'


def _load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding='utf-8') as handle:
        return list(csv.DictReader(handle))


def main() -> None:
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

    OUTPUT_PATH.write_text(json.dumps(trip, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}')


if __name__ == '__main__':
    main()
