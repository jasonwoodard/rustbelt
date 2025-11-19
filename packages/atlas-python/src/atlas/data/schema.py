"""Dataset schema definitions for Atlas data ingestion."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Mapping, Sequence

import pandas as pd
from pandas._typing import DtypeArg

StringDtype = pd.StringDtype
Int64Dtype = pd.Int64Dtype


@dataclass(frozen=True)
class DatasetSchema:
    """Schema describing required columns and dtypes for a dataset."""

    name: str
    required_columns: Sequence[str]
    optional_columns: Sequence[str] = ()
    dtypes: Mapping[str, DtypeArg] = field(default_factory=dict)

    def missing_required(self, columns: Iterable[str]) -> list[str]:
        provided = {column for column in columns}
        return sorted(column for column in self.required_columns if column not in provided)

    @property
    def expected_columns(self) -> tuple[str, ...]:
        return tuple(self.required_columns) + tuple(self.optional_columns)

    def dtype_for_read(self) -> dict[str, DtypeArg]:
        """Return dtype mapping limited to expected columns."""
        return {column: dtype for column, dtype in self.dtypes.items() if column in self.expected_columns}

    def coerce_dtypes(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Coerce columns that are present to their configured dtypes."""
        dtype_map = {column: dtype for column, dtype in self.dtype_for_read().items() if column in frame.columns}
        if dtype_map:
            frame = frame.astype(dtype_map, copy=False)
        return frame


STRING = StringDtype()
INT64 = Int64Dtype()
FLOAT64 = "float64"

STORES_SCHEMA = DatasetSchema(
    name="stores",
    required_columns=("StoreId", "Name", "Type", "Lat", "Lon"),
    optional_columns=("GeoId", "ChainFlag", "Notes", "Zip"),
    dtypes={
        "StoreId": STRING,
        "Name": STRING,
        "Type": STRING,
        "Lat": FLOAT64,
        "Lon": FLOAT64,
        "GeoId": STRING,
        "ChainFlag": STRING,
        "Notes": STRING,
        "Zip": STRING,
    },
)

AFFLUENCE_SCHEMA = DatasetSchema(
    name="affluence",
    required_columns=("GeoId", "MedianIncome", "Pct100kHH", "Education", "HomeValue", "Turnover"),
    optional_columns=("Metro", "County"),
    dtypes={
        "GeoId": STRING,
        "MedianIncome": FLOAT64,
        "Pct100kHH": FLOAT64,
        "Education": FLOAT64,
        "HomeValue": FLOAT64,
        "Turnover": FLOAT64,
        "Metro": STRING,
        "County": STRING,
    },
)

OBSERVATIONS_SCHEMA = DatasetSchema(
    name="observations",
    required_columns=("StoreId", "DateTime", "DwellMin", "PurchasedItems", "HaulLikert"),
    optional_columns=("ObserverId", "Spend", "Notes"),
    dtypes={
        "StoreId": STRING,
        "DateTime": STRING,
        "DwellMin": FLOAT64,
        "PurchasedItems": INT64,
        "HaulLikert": FLOAT64,
        "ObserverId": STRING,
        "Spend": FLOAT64,
        "Notes": STRING,
    },
)

SCHEMAS: Mapping[str, DatasetSchema] = {
    schema.name: schema
    for schema in (STORES_SCHEMA, AFFLUENCE_SCHEMA, OBSERVATIONS_SCHEMA)
}

__all__ = [
    "DatasetSchema",
    "SCHEMAS",
    "STORES_SCHEMA",
    "AFFLUENCE_SCHEMA",
    "OBSERVATIONS_SCHEMA",
]
