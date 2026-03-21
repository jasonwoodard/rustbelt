"""Summary report formatting for rustbelt-discover."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

# Nearby Search (Essentials SKU) and Place Details with hours (Pro SKU)
_NEARBY_SEARCH_COST_PER_CALL = 0.000_32   # ~$0.32/1000
_PLACE_DETAILS_COST_PER_CALL = 0.003_00   # ~$3.00/1000 (Pro, with regularOpeningHours)
_FREE_TIER_CREDIT = 200.0                  # USD/month


@dataclass
class RunStats:
    lat: float
    lon: float
    radius_miles: float

    search_term_count: int = 0
    raw_result_count: int = 0
    unique_place_count: int = 0
    details_fetched: int = 0

    inserted: int = 0
    updated: int = 0
    skipped: int = 0

    type_counts: dict[str, int] = field(default_factory=dict)
    hours_with_data: int = 0        # places where regularOpeningHours was present

    new_zips: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    nearby_search_calls: int = 0
    place_details_calls: int = 0


def _separator(width: int = 60) -> str:
    return "\u2501" * width  # ━


def format_report(stats: RunStats, dry_run: bool = False) -> str:
    sep = _separator()
    total_api = stats.nearby_search_calls + stats.place_details_calls
    estimated_cost = (
        stats.nearby_search_calls * _NEARBY_SEARCH_COST_PER_CALL
        + stats.place_details_calls * _PLACE_DETAILS_COST_PER_CALL
    )
    within_free = estimated_cost < _FREE_TIER_CREDIT

    hours_total = stats.details_fetched
    hours_pct = (
        f"{stats.hours_with_data / hours_total * 100:.0f}%"
        if hours_total > 0
        else "n/a"
    )

    lines: list[str] = []
    lines.append(
        f"rustbelt-discover — area ({stats.lat}, {stats.lon}) r={stats.radius_miles:.0f}mi"
    )
    lines.append(sep)
    lines.append(f"Search terms:    {stats.search_term_count}")
    lines.append(f"Raw results:     {stats.raw_result_count}  (after pagination)")
    lines.append(f"Unique places:   {stats.unique_place_count}  (after deduplication by Place ID)")
    lines.append(f"Details fetched: {stats.details_fetched}")
    lines.append("")

    if dry_run:
        lines.append(f"  Would process: {stats.details_fetched - stats.skipped}")
        lines.append(f"  Skipped (error): {stats.skipped:2d}")
    else:
        lines.append(f"  Inserted (new):  {stats.inserted:2d}")
        lines.append(f"  Updated (exist): {stats.updated:2d}")
        lines.append(f"  Skipped (error): {stats.skipped:2d}")

    if stats.type_counts:
        lines.append("")
        lines.append("By type:")
        for store_type, count in sorted(stats.type_counts.items()):
            lines.append(f"  {store_type}:{' ' * (8 - len(store_type))}{count}")

    lines.append("")
    lines.append(
        f"Hours coverage:  {stats.hours_with_data} / {hours_total}  ({hours_pct})"
    )

    if not dry_run and stats.new_zips:
        sorted_zips = sorted(stats.new_zips)
        lines.append("")
        lines.append(f"New ZIPs (for rustbelt-census):  {len(sorted_zips)}")
        lines.append("  " + ", ".join(sorted_zips))

    if stats.errors:
        lines.append("")
        lines.append("Errors:")
        for err in stats.errors:
            lines.append(f"  {err}")

    lines.append("")
    cost_note = (
        f"~${estimated_cost:.2f}  (within free tier)"
        if within_free
        else f"~${estimated_cost:.2f}"
    )
    lines.append(
        f"API calls:  {stats.nearby_search_calls} Nearby Search"
        f" + {stats.place_details_calls} Place Details = {total_api} total"
    )
    lines.append(f"Estimated cost: {cost_note}")
    lines.append(sep)

    if dry_run:
        lines.append("DRY RUN — no database writes performed")

    return "\n".join(lines)


def format_zips_file(stats: RunStats) -> str:
    """Return the content of the new-ZIPs output file."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sorted_zips = sorted(stats.new_zips)
    header_lines = [
        f"# rustbelt-discover new ZIPs — {now}",
        f"# area ({stats.lat}, {stats.lon}) r={stats.radius_miles:.0f}mi",
        "# Feed to: rustbelt-census affluence --zips-file discover-zips.txt --out <output>.csv",
    ]
    return "\n".join(header_lines + sorted_zips) + "\n"
