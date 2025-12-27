from rustbelt_census.derive import pct_hh_100k_plus, pct_renters


def test_pct_renters_ok():
    value, error = pct_renters(25, 100)
    assert value == 25.0
    assert error is None


def test_pct_renters_zero_denom():
    value, error = pct_renters(10, 0)
    assert value is None
    assert "0" in error


def test_pct_hh_100k_plus_ok():
    value, error = pct_hh_100k_plus(50, 200)
    assert value == 25.0
    assert error is None


def test_pct_hh_100k_plus_zero_denom():
    value, error = pct_hh_100k_plus(50, 0)
    assert value is None
    assert "0" in error
