import pytest

from rustbelt_census.cli import load_zips_file, normalize_zips


def test_normalize_zips_dedup_and_order():
    result = normalize_zips(["19103", " 19103 ", "19104"])
    assert result == ["19103", "19104"]


def test_normalize_zips_invalid():
    with pytest.raises(ValueError):
        normalize_zips(["12A45"])


def test_load_zips_file(tmp_path):
    path = tmp_path / "zips.txt"
    path.write_text(
        """
# comment
19103

19104
"""
    )
    assert load_zips_file(path) == ["19103", "19104"]
