"""Convert Google Places regularOpeningHours to storedb store_hours rows.

Google day convention:  0=Sunday, 1=Monday, ..., 6=Saturday
storedb day convention: 0=Monday, 1=Tuesday, ..., 6=Sunday

Mapping formula: storedb_day = (google_day + 6) % 7
  google 0 (Sun) → (0+6)%7 = 6  (storedb Sun) ✓
  google 1 (Mon) → (1+6)%7 = 0  (storedb Mon) ✓
  google 6 (Sat) → (6+6)%7 = 5  (storedb Sat) ✓
"""

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_GOOGLE_DAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday",
]


@dataclass
class HoursRow:
    day_of_week: int          # storedb convention: 0=Mon..6=Sun
    open_min: Optional[int]   # minutes since midnight; None means closed
    close_min: Optional[int]


def google_day_to_storedb(google_day: int) -> int:
    """Remap Google day index (0=Sun) to storedb day index (0=Mon)."""
    return (google_day + 6) % 7


def time_to_minutes(hour: int, minute: int) -> int:
    """Convert hour/minute to integer minutes since midnight."""
    return hour * 60 + minute


def parse_opening_hours(
    store_name: str,
    regular_opening_hours: Optional[dict],
) -> list[HoursRow]:
    """Convert regularOpeningHours dict to a list of HoursRow.

    Returns an empty list if regular_opening_hours is None (no hours data
    available — caller must not write any store_hours rows in this case).

    For stores with hours data, always returns 7 rows (one per day).
    Days absent from the periods array are written as closed (NULL open/close).
    If a day has multiple periods (split hours), the first is used and a
    warning is logged.
    """
    if regular_opening_hours is None:
        return []

    periods = regular_opening_hours.get("periods", [])

    # Group periods by Google day number
    periods_by_google_day: dict[int, list[dict]] = {}
    for period in periods:
        open_info = period.get("open", {})
        google_day = open_info.get("day")
        if google_day is None:
            continue
        periods_by_google_day.setdefault(google_day, []).append(period)

    rows: list[HoursRow] = []
    for google_day in range(7):  # 0=Sun .. 6=Sat
        storedb_day = google_day_to_storedb(google_day)
        day_periods = periods_by_google_day.get(google_day, [])

        if not day_periods:
            # Closed this day (or not listed) → NULL row
            rows.append(HoursRow(day_of_week=storedb_day, open_min=None, close_min=None))
            continue

        if len(day_periods) > 1:
            day_name = _GOOGLE_DAY_NAMES[google_day]
            logger.warning(
                "[warn] store '%s': %s has %d open windows; using first only.",
                store_name,
                day_name,
                len(day_periods),
            )

        period = day_periods[0]
        open_info = period.get("open", {})
        close_info = period.get("close", {})

        open_min = time_to_minutes(
            open_info.get("hour", 0),
            open_info.get("minute", 0),
        )
        close_min = time_to_minutes(
            close_info.get("hour", 0),
            close_info.get("minute", 0),
        )
        rows.append(HoursRow(day_of_week=storedb_day, open_min=open_min, close_min=close_min))

    return rows
