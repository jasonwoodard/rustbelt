import io

from rustbelt_census.formatters import write_rows


def test_write_csv_with_nulls_and_header():
    rows = [
        {
            "zip": "01234",
            "name": "Test",
            "median_income": None,
            "pct_hh_100k_plus": 12.3456,
            "pct_renters": None,
            "population": 1000,
            "acs_year": 2023,
            "dataset": "acs/acs5",
            "fetched_at_utc": "2024-01-01T00:00:00Z",
            "status": "missing",
            "error_message": "Missing",
            "renters_count": None,
            "occupied_count": None,
            "hh_count_100k_plus": None,
            "hh_count_total": None,
        }
    ]
    buffer = io.StringIO()
    write_rows(
        rows,
        buffer,
        output_format="csv",
        include_audit_fields=True,
        precision=3,
        emit_sqlite_ready=True,
    )
    content = buffer.getvalue().strip().splitlines()
    assert content[0].startswith("zip,name,median_income")
    assert ",01234," in f",{content[1]},"
    assert ",," in content[1]
