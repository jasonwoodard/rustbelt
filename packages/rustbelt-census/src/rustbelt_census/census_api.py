import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

from rustbelt_census.cache import read_cache_json, write_cache_json


DISCOVERY_URL = "https://api.census.gov/data.json"
DATASET = "acs/acs5"
ZCTA_FIELD = "zip code tabulation area"

AFFLUENCE_VARIABLES = [
    "NAME",
    "B19013_001E",
    "B01003_001E",
    "B25003_001E",
    "B25003_003E",
    "B19001_001E",
    "B19001_013E",
    "B19001_014E",
    "B19001_015E",
    "B19001_016E",
    "B19001_017E",
]


class ApiError(RuntimeError):
    pass


@dataclass
class FetchResult:
    rows: list[dict[str, str]]
    cache_hit: bool



def _request_json(
    session: requests.Session,
    url: str,
    params: Optional[dict[str, Any]],
    timeout: int,
    retries: int,
) -> Any:
    last_error: Optional[Exception] = None
    for _ in range(max(retries, 1)):
        try:
            response = session.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, json.JSONDecodeError) as exc:
            last_error = exc
    raise ApiError(f"Request failed for {url}: {last_error}")


def _parse_dataset_years(data: dict[str, Any]) -> list[int]:
    years: list[int] = []
    for entry in data.get("dataset", []):
        c_dataset = entry.get("c_dataset") or []
        identifier = entry.get("identifier") or ""
        if isinstance(c_dataset, str):
            c_dataset = [c_dataset]
        dataset_tokens = {token.lower() for token in c_dataset}
        if "acs" not in dataset_tokens:
            continue
        if "acs5" not in dataset_tokens and "acs/acs5" not in identifier:
            continue
        year_value = entry.get("year") or entry.get("c_vintage")
        if year_value is None:
            continue
        try:
            years.append(int(year_value))
        except (TypeError, ValueError):
            continue
    return years


def discover_latest_acs5_year(
    session: requests.Session,
    cache_path: Path,
    timeout: int,
    retries: int,
    cache_ttl_days: int,
) -> tuple[int, bool]:
    cached = read_cache_json(cache_path, ttl_days=cache_ttl_days)
    if cached and "year" in cached:
        return int(cached["year"]), True

    data = _request_json(session, DISCOVERY_URL, None, timeout, retries)
    years = _parse_dataset_years(data)
    if not years:
        raise ApiError("No ACS5 datasets found in discovery metadata.")
    year = max(years)
    write_cache_json(
        cache_path,
        {
            "year": year,
            "dataset": DATASET,
        },
    )
    return year, False


def _build_base_params() -> dict[str, str]:
    return {
        "get": ",".join(AFFLUENCE_VARIABLES),
    }


def _parse_census_rows(raw: Iterable[Iterable[str]]) -> list[dict[str, str]]:
    rows = list(raw)
    if not rows:
        return []
    header = rows[0]
    results = []
    for row in rows[1:]:
        results.append({key: value for key, value in zip(header, row)})
    return results


def fetch_state_zcta_rows(
    session: requests.Session,
    year: int,
    state_ucgid: str,
    cache_path: Path,
    timeout: int,
    retries: int,
    cache_ttl_days: int,
    api_key: Optional[str],
) -> FetchResult:
    cached = read_cache_json(cache_path, ttl_days=cache_ttl_days)
    if cached and "rows" in cached:
        return FetchResult(rows=cached["rows"], cache_hit=True)

    url = f"https://api.census.gov/data/{year}/{DATASET}"
    params = _build_base_params()
    params.update(
        {
            "for": f"{ZCTA_FIELD}:*",
            "ucgid": state_ucgid,
        }
    )
    if api_key:
        params["key"] = api_key
    raw = _request_json(session, url, params, timeout, retries)
    rows = _parse_census_rows(raw)
    write_cache_json(cache_path, {"rows": rows})
    return FetchResult(rows=rows, cache_hit=False)


def fetch_zcta_row(
    session: requests.Session,
    year: int,
    zip_code: str,
    timeout: int,
    retries: int,
    api_key: Optional[str],
) -> dict[str, str]:
    url = f"https://api.census.gov/data/{year}/{DATASET}"
    params = _build_base_params()
    params.update(
        {
            "for": f"{ZCTA_FIELD}:{zip_code}",
        }
    )
    if api_key:
        params["key"] = api_key
    raw = _request_json(session, url, params, timeout, retries)
    rows = _parse_census_rows(raw)
    if not rows:
        raise ApiError(f"No data returned for ZCTA {zip_code}.")
    return rows[0]
