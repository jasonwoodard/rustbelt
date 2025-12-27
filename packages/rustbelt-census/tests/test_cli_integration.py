import argparse
import json

from rustbelt_census import cli
from rustbelt_census.formatters import BASE_FIELDS


def test_affluence_cli_outputs_expected_schema(monkeypatch, tmp_path, capsys):
    def fake_discover_latest_acs5_year(session, cache_path, timeout, retries, cache_ttl_days, refresh_cache=False):
        return 2022, False

    def fake_fetch_zcta_row(session, year, zip_code, timeout, retries, api_key):
        return {
            "NAME": "Test ZCTA",
            "B19013_001E": "75000",
            "B01003_001E": "2000",
            "B25003_001E": "800",
            "B25003_003E": "200",
            "B19001_001E": "1000",
            "B19001_013E": "100",
            "B19001_014E": "50",
            "B19001_015E": "30",
            "B19001_016E": "20",
            "B19001_017E": "10",
        }

    monkeypatch.setattr(cli, "discover_latest_acs5_year", fake_discover_latest_acs5_year)
    monkeypatch.setattr(cli, "fetch_zcta_row", fake_fetch_zcta_row)

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

    assert row["AcsYear"] == 2022
    assert row["Status"] == "ok"

    for key in ("PctHH_100kPlus", "PctRenters"):
        value = row[key]
        assert value is not None
        assert 0 <= value <= 100
