import requests

from rustbelt_census import census_api


def test_fetch_state_zcta_rows_uses_ucgid(monkeypatch, tmp_path):
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
        "0400000US42",
        tmp_path / "state.json",
        timeout=1,
        retries=1,
        cache_ttl_days=0,
        api_key=None,
    )

    assert captured["params"]["ucgid"] == "0400000US42"
    assert captured["params"]["for"] == f"{census_api.ZCTA_FIELD}:*"
    assert "in" not in captured["params"]
    assert result.rows == [{"NAME": "Test ZCTA", census_api.ZCTA_FIELD: "12345"}]
