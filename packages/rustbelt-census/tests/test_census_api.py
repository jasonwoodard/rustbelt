import requests

from rustbelt_census import census_api


def test_fetch_state_zcta_rows_uses_state_filter(monkeypatch, tmp_path):
    captured: dict[str, dict[str, str]] = {}

    def fake_request_json(session, url, params, timeout, retries):
        captured["params"] = params
        return [
            ["NAME", census_api.ZCTA_FIELD],
            ["Test ZCTA", "12345"],
        ]

    monkeypatch.setattr(census_api, "_request_json", fake_request_json)

    result = census_api.fetch_state_zcta_rows(
        requests.Session(),
        2023,
        "42",
        tmp_path / "state.json",
        timeout=1,
        retries=1,
        cache_ttl_days=0,
        api_key=None,
    )

    assert captured["params"]["ucgid"] == "pseudo(0400000US42$8600000)"
    assert result.rows == [{"NAME": "Test ZCTA", census_api.ZCTA_FIELD: "12345"}]


def test_discover_latest_acs5_year_refresh_bypasses_cache(monkeypatch, tmp_path):
    def fake_read_cache_json(path, ttl_days=None):
        return {"year": 2020}

    requested = {"called": False}

    def fake_request_json(session, url, params, timeout, retries):
        requested["called"] = True
        return {
            "dataset": [
                {"c_dataset": ["acs", "acs5"], "year": 2022},
                {"c_dataset": ["acs", "acs5"], "year": 2021},
            ]
        }

    monkeypatch.setattr(census_api, "read_cache_json", fake_read_cache_json)
    monkeypatch.setattr(census_api, "_request_json", fake_request_json)

    year, cache_hit = census_api.discover_latest_acs5_year(
        requests.Session(),
        tmp_path / "latest.json",
        timeout=1,
        retries=1,
        cache_ttl_days=1,
        refresh_cache=True,
    )

    assert requested["called"] is True
    assert year == 2022
    assert cache_hit is False


def test_fetch_state_zcta_rows_refresh_bypasses_cache(monkeypatch, tmp_path):
    def fake_read_cache_json(path, ttl_days=None):
        return {"rows": [{"NAME": "Cached ZCTA", census_api.ZCTA_FIELD: "99999"}]}

    requested = {"called": False}

    def fake_request_json(session, url, params, timeout, retries):
        requested["called"] = True
        return [
            ["NAME", census_api.ZCTA_FIELD],
            ["Fresh ZCTA", "12345"],
        ]

    monkeypatch.setattr(census_api, "read_cache_json", fake_read_cache_json)
    monkeypatch.setattr(census_api, "_request_json", fake_request_json)

    result = census_api.fetch_state_zcta_rows(
        requests.Session(),
        2023,
        "42",
        tmp_path / "state.json",
        timeout=1,
        retries=1,
        cache_ttl_days=1,
        api_key=None,
        refresh_cache=True,
    )

    assert requested["called"] is True
    assert result.cache_hit is False
    assert result.rows == [{"NAME": "Fresh ZCTA", census_api.ZCTA_FIELD: "12345"}]
