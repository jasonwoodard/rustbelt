from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from atlas.data import (
    MissingColumnsError,
    load_affluence,
    load_observations,
    load_stores,
)


def test_load_stores_csv(tmp_path: Path) -> None:
    stores_path = tmp_path / "stores.csv"
    df = pd.DataFrame(
        [
            {
                "StoreId": "DT-001",
                "Name": "Downtown Flagship",
                "Type": "Flagship",
                "Lat": 42.331,
                "Lon": -83.045,
                "ChainFlag": "Y",
            }
        ]
    )
    df.to_csv(stores_path, index=False)

    result = load_stores(stores_path)

    assert result.shape == (1, 6)
    assert result.loc[0, "StoreId"] == "DT-001"
    assert pytest.approx(result.loc[0, "Lat"], rel=1e-6) == 42.331


def test_load_observations_missing_column(tmp_path: Path) -> None:
    observations_path = tmp_path / "observations.csv"
    observations_path.write_text(
        "StoreId,DateTime,DwellMin,PurchasedItems\n"
        "DT-001,2025-03-02T14:10Z,52,4\n",
        encoding="utf-8",
    )

    with pytest.raises(MissingColumnsError) as excinfo:
        load_observations(observations_path)

    assert "HaulLikert" in str(excinfo.value)


def test_load_affluence_json(tmp_path: Path) -> None:
    affluence_path = tmp_path / "affluence.json"
    records = [
        {
            "GeoId": "12345",
            "MedianIncome": 55000,
            "Pct100kHH": 0.28,
            "Education": 0.6,
            "HomeValue": 210000,
            "Turnover": 0.1,
            "Metro": "Detroit",
        }
    ]
    affluence_path.write_text(json.dumps(records), encoding="utf-8")

    result = load_affluence(affluence_path)

    assert list(result.columns)[:6] == [
        "GeoId",
        "MedianIncome",
        "Pct100kHH",
        "Education",
        "HomeValue",
        "Turnover",
    ]
    assert result.loc[0, "Metro"] == "Detroit"
