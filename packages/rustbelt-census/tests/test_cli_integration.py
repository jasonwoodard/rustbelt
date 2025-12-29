import argparse
import json

import pytest

from rustbelt_census import cli
from rustbelt_census import census_api
from rustbelt_census.formatters import BASE_FIELDS


def test_affluence_cli_outputs_expected_schema(monkeypatch, tmp_path, capsys):
    def fake_discover_latest_acs5_year(session, cache_path, timeout, retries, cache_ttl_days, refresh_cache=False):
        return 2022, False

    def fake_request_json(session, url, params, timeout, retries):
        return [
            [
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
                cli.ZCTA_FIELD,
            ],
            [
                "Test ZCTA",
                "75000",
                "2000",
                "800",
                "200",
                "1000",
                "100",
                "50",
                "30",
                "20",
                "10",
                "12345",
            ],
        ]

    monkeypatch.setattr(cli, "discover_latest_acs5_year", fake_discover_latest_acs5_year)
    monkeypatch.setattr(cli, "_request_json", fake_request_json)

    args = argparse.Namespace(
        zips="12345",
        zips_file=None,
        state=None,
        out=None,
        format="jsonl",
        emit_sqlite_ready=True,
        include_audit_fields=True,
        cache_dir=str(tmp_path),
        timeout=1,
        retries=1,
        api_key_env="CENSUS_API_KEY",
        precision=3,
        refresh_cache=False,
    )

    result = cli.run_affluence(args, cli.build_parser())
    assert result == 0

    output = capsys.readouterr().out.strip().splitlines()
    assert len(output) == 1
    row = json.loads(output[0])

    for field in BASE_FIELDS:
        assert field in row

    assert row["acs_year"] == 2022
    assert row["status"] == "ok"

    for key in ("pct_hh_100k_plus", "pct_renters"):
        value = row[key]
        assert value is not None
        assert 0 <= value <= 100


def test_affluence_cli_requires_input_mode(tmp_path):
    args = argparse.Namespace(
        zips=None,
        zips_file=None,
        state=None,
        out=None,
        format="jsonl",
        emit_sqlite_ready=True,
        include_audit_fields=True,
        cache_dir=str(tmp_path),
        timeout=1,
        retries=1,
        api_key_env="CENSUS_API_KEY",
        precision=3,
        refresh_cache=False,
    )

    with pytest.raises(cli.UsageError):
        cli.run_affluence(args, cli.build_parser())


def test_affluence_cli_rejects_invalid_state(tmp_path):
    args = argparse.Namespace(
        zips=None,
        zips_file=None,
        state="PX",
        out=None,
        format="jsonl",
        emit_sqlite_ready=True,
        include_audit_fields=True,
        cache_dir=str(tmp_path),
        timeout=1,
        retries=1,
        api_key_env="CENSUS_API_KEY",
        precision=3,
        refresh_cache=False,
    )

    with pytest.raises(cli.UsageError):
        cli.run_affluence(args, cli.build_parser())


def test_affluence_cli_state_only_sorts_output(monkeypatch, tmp_path, capsys):
    def fake_discover_latest_acs5_year(session, cache_path, timeout, retries, cache_ttl_days, refresh_cache=False):
        return 2022, False

    def fake_fetch_state_zcta_rows(
        session,
        year,
        state_fips,
        cache_path,
        timeout,
        retries,
        cache_ttl_days,
        api_key,
        refresh_cache=False,
    ):
        return census_api.FetchResult(
            rows=[
                {"NAME": "ZCTA 99999", cli.ZCTA_FIELD: "99999"},
                {"NAME": "ZCTA 11111", cli.ZCTA_FIELD: "11111"},
            ],
            cache_hit=False,
        )

    monkeypatch.setattr(cli, "discover_latest_acs5_year", fake_discover_latest_acs5_year)
    monkeypatch.setattr(cli, "fetch_state_zcta_rows", fake_fetch_state_zcta_rows)

    args = argparse.Namespace(
        zips=None,
        zips_file=None,
        state="PA",
        out=None,
        format="jsonl",
        emit_sqlite_ready=True,
        include_audit_fields=True,
        cache_dir=str(tmp_path),
        timeout=1,
        retries=1,
        api_key_env="CENSUS_API_KEY",
        precision=3,
        refresh_cache=False,
    )

    result = cli.run_affluence(args, cli.build_parser())
    assert result == 0

    output = capsys.readouterr().out.strip().splitlines()
    assert [json.loads(line)["zip"] for line in output] == ["11111", "99999"]


def test_affluence_cli_state_with_zips_preserves_order(monkeypatch, tmp_path, capsys):
    def fake_discover_latest_acs5_year(session, cache_path, timeout, retries, cache_ttl_days, refresh_cache=False):
        return 2022, False

    def fake_fetch_state_zcta_rows(
        session,
        year,
        state_fips,
        cache_path,
        timeout,
        retries,
        cache_ttl_days,
        api_key,
        refresh_cache=False,
    ):
        return census_api.FetchResult(
            rows=[
                {"NAME": "ZCTA 19104", cli.ZCTA_FIELD: "19104"},
            ],
            cache_hit=False,
        )

    monkeypatch.setattr(cli, "discover_latest_acs5_year", fake_discover_latest_acs5_year)
    monkeypatch.setattr(cli, "fetch_state_zcta_rows", fake_fetch_state_zcta_rows)

    args = argparse.Namespace(
        zips="19104,19103",
        zips_file=None,
        state="PA",
        out=None,
        format="jsonl",
        emit_sqlite_ready=True,
        include_audit_fields=True,
        cache_dir=str(tmp_path),
        timeout=1,
        retries=1,
        api_key_env="CENSUS_API_KEY",
        precision=3,
        refresh_cache=False,
    )

    result = cli.run_affluence(args, cli.build_parser())
    assert result == 0

    output = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert [row["zip"] for row in output] == ["19104", "19103"]
    assert output[1]["status"] == "missing"
