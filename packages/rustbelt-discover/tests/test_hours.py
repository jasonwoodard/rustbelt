"""Tests for discover.hours — Google opening hours → storedb conversion.

Coverage:
  - Standard open/close conversion (minutes-since-midnight arithmetic)
  - Sunday remapping: Google day 0 → storedb day 6
  - Closed day: no periods entry → HoursRow with NULL open_min/close_min
  - Missing regularOpeningHours entirely → empty list (no rows written)
  - Split day with 2 periods → uses first, emits warning
"""

import logging

import pytest

from discover.hours import (
    HoursRow,
    google_day_to_storedb,
    parse_opening_hours,
    time_to_minutes,
)


# ---------------------------------------------------------------------------
# Unit helpers
# ---------------------------------------------------------------------------


def test_time_to_minutes_round_hour():
    assert time_to_minutes(10, 0) == 600


def test_time_to_minutes_with_minutes():
    assert time_to_minutes(9, 30) == 570


def test_time_to_minutes_midnight():
    assert time_to_minutes(0, 0) == 0


def test_time_to_minutes_end_of_day():
    assert time_to_minutes(23, 59) == 1439


# ---------------------------------------------------------------------------
# Day remapping
# ---------------------------------------------------------------------------


def test_google_day_sunday_maps_to_storedb_6():
    """Google 0 (Sunday) must map to storedb 6 (Sunday)."""
    assert google_day_to_storedb(0) == 6


def test_google_day_monday_maps_to_storedb_0():
    assert google_day_to_storedb(1) == 0


def test_google_day_saturday_maps_to_storedb_5():
    assert google_day_to_storedb(6) == 5


def test_google_day_full_week_roundtrip():
    # Verify the full mapping table from §8.2
    expected = {0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}
    for google_day, storedb_day in expected.items():
        assert google_day_to_storedb(google_day) == storedb_day, (
            f"google_day={google_day} should map to {storedb_day}, "
            f"got {google_day_to_storedb(google_day)}"
        )


# ---------------------------------------------------------------------------
# parse_opening_hours — missing regularOpeningHours entirely
# ---------------------------------------------------------------------------


def test_missing_hours_returns_empty_list():
    """No regularOpeningHours → no rows should be written."""
    rows = parse_opening_hours("Test Store", None)
    assert rows == []


def test_empty_dict_returns_seven_closed_rows():
    """An empty dict (no 'periods' key) means we have a hours object but all days closed."""
    rows = parse_opening_hours("Test Store", {})
    assert len(rows) == 7
    for row in rows:
        assert row.open_min is None
        assert row.close_min is None


# ---------------------------------------------------------------------------
# parse_opening_hours — standard open/close conversion
# ---------------------------------------------------------------------------


def _make_period(google_day: int, open_hour: int, open_min: int, close_hour: int, close_min: int) -> dict:
    return {
        "open":  {"day": google_day, "hour": open_hour,  "minute": open_min},
        "close": {"day": google_day, "hour": close_hour, "minute": close_min},
    }


def test_standard_open_close_conversion():
    """Monday 10:00–17:00 → open_min=600, close_min=1020."""
    hours = {
        "periods": [_make_period(google_day=1, open_hour=10, open_min=0, close_hour=17, close_min=0)]
    }
    rows = parse_opening_hours("Shop", hours)
    assert len(rows) == 7

    # Find the storedb Monday row (day_of_week=0)
    monday_row = next(r for r in rows if r.day_of_week == 0)
    assert monday_row.open_min == 600
    assert monday_row.close_min == 1020


def test_open_close_with_nonzero_minutes():
    """Friday 9:30–17:45 should be converted correctly."""
    hours = {
        "periods": [_make_period(google_day=5, open_hour=9, open_min=30, close_hour=17, close_min=45)]
    }
    rows = parse_opening_hours("Shop", hours)
    friday_row = next(r for r in rows if r.day_of_week == 4)  # google 5 → storedb 4
    assert friday_row.open_min == 9 * 60 + 30   # 570
    assert friday_row.close_min == 17 * 60 + 45  # 1065


# ---------------------------------------------------------------------------
# parse_opening_hours — Sunday remapping
# ---------------------------------------------------------------------------


def test_sunday_period_maps_to_storedb_day_6():
    """Google Sunday (day=0) must produce a row with day_of_week=6."""
    hours = {
        "periods": [_make_period(google_day=0, open_hour=12, open_min=0, close_hour=17, close_min=0)]
    }
    rows = parse_opening_hours("Shop", hours)
    sunday_row = next(r for r in rows if r.day_of_week == 6)
    assert sunday_row.open_min == 720   # 12*60
    assert sunday_row.close_min == 1020  # 17*60


def test_sunday_is_not_treated_as_monday():
    """Regression: Google day 0 must not appear as storedb day 0."""
    hours = {
        "periods": [
            _make_period(google_day=0, open_hour=12, open_min=0, close_hour=17, close_min=0),
            _make_period(google_day=1, open_hour=10, open_min=0, close_hour=18, close_min=0),
        ]
    }
    rows_by_day = {r.day_of_week: r for r in parse_opening_hours("Shop", hours)}
    assert rows_by_day[6].open_min == 720   # storedb Sunday
    assert rows_by_day[0].open_min == 600   # storedb Monday
    assert rows_by_day[6].open_min != rows_by_day[0].open_min


# ---------------------------------------------------------------------------
# parse_opening_hours — closed day (no periods entry)
# ---------------------------------------------------------------------------


def test_closed_day_produces_null_row():
    """A day absent from periods should produce a row with NULL open/close."""
    # Only Monday open; all other days closed
    hours = {
        "periods": [_make_period(google_day=1, open_hour=10, open_min=0, close_hour=17, close_min=0)]
    }
    rows = parse_opening_hours("Shop", hours)
    assert len(rows) == 7

    closed_days = [r for r in rows if r.day_of_week != 0]  # everything except Monday
    for row in closed_days:
        assert row.open_min is None, f"day_of_week={row.day_of_week} should be closed"
        assert row.close_min is None


def test_all_days_closed_all_null():
    """Store with empty periods → all 7 rows with NULL hours."""
    rows = parse_opening_hours("Closed Store", {"periods": []})
    assert len(rows) == 7
    for row in rows:
        assert row.open_min is None
        assert row.close_min is None


# ---------------------------------------------------------------------------
# parse_opening_hours — split day (2 periods → use first, warn)
# ---------------------------------------------------------------------------


def test_split_day_uses_first_period(caplog):
    """When a day has 2 periods, the first must be used and a warning logged."""
    hours = {
        "periods": [
            _make_period(google_day=4, open_hour=10, open_min=0, close_hour=13, close_min=0),
            _make_period(google_day=4, open_hour=15, open_min=0, close_hour=20, close_min=0),
        ]
    }
    with caplog.at_level(logging.WARNING, logger="discover.hours"):
        rows = parse_opening_hours("Venice Antique Mall", hours)

    # storedb Thursday = google day 4 → (4+6)%7 = 3
    thursday_row = next(r for r in rows if r.day_of_week == 3)
    assert thursday_row.open_min == 600   # 10:00 (first period)
    assert thursday_row.close_min == 780  # 13:00 (first period)

    # Warning must mention the store name and count
    assert any("Venice Antique Mall" in msg for msg in caplog.messages)
    assert any("2" in msg for msg in caplog.messages)


def test_split_day_does_not_use_second_period(caplog):
    """The second window's times must NOT appear in the stored row."""
    hours = {
        "periods": [
            _make_period(google_day=2, open_hour=9, open_min=0,  close_hour=12, close_min=0),
            _make_period(google_day=2, open_hour=14, open_min=0, close_hour=18, close_min=0),
        ]
    }
    with caplog.at_level(logging.WARNING, logger="discover.hours"):
        rows = parse_opening_hours("Shop", hours)

    # storedb Tuesday = google day 2 → (2+6)%7 = 1
    tuesday_row = next(r for r in rows if r.day_of_week == 1)
    assert tuesday_row.open_min != 14 * 60   # must not be the second window's open
    assert tuesday_row.open_min == 9 * 60    # must be the first window
