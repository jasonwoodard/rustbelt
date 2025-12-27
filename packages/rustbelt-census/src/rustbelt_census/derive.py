from typing import Optional, Tuple


def pct_renters(
    renters: Optional[int],
    occupied: Optional[int],
    precision: int = 3,
) -> Tuple[Optional[float], Optional[str]]:
    if renters is None or occupied is None:
        return None, "Missing renter or occupied counts."
    if occupied == 0:
        return None, "Occupied count is 0."
    value = 100.0 * renters / occupied
    return round(value, precision), None


def pct_hh_100k_plus(
    hh_over_100k: Optional[int],
    hh_total: Optional[int],
    precision: int = 3,
) -> Tuple[Optional[float], Optional[str]]:
    if hh_over_100k is None or hh_total is None:
        return None, "Missing household income counts."
    if hh_total == 0:
        return None, "Household total is 0."
    value = 100.0 * hh_over_100k / hh_total
    return round(value, precision), None
