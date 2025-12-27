import io

from rustbelt_census.formatters import write_rows


def test_write_csv_with_nulls_and_header():
    rows = [
        {
            "Zip": "01234",
            "Name": "Test",
            "MedianIncome": None,
            "PctHH_100kPlus": 12.3456,
            "PctRenters": None,
            "Population": 1000,
            "AcsYear": 2023,
            "Dataset": "acs/acs5",
            "FetchedAtUtc": "2024-01-01T00:00:00Z",
            "Status": "missing",
            "ErrorMessage": "Missing",
            "RentersCount": None,
            "OccupiedCount": None,
            "HHCount_100kPlus": None,
            "HHCountTotal": None,
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
    assert content[0].startswith("Zip,Name,MedianIncome")
    assert ",01234," in f",{content[1]},"
    assert ",," in content[1]
