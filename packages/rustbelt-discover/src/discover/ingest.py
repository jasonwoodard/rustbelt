"""Database write logic for rustbelt-discover.

Each store is written in a savepoint so a failure for one store does not
affect others. Three tables are written per store:
  - stores          (INSERT ... ON CONFLICT(store_name, address) DO UPDATE)
  - store_google    (INSERT ... ON CONFLICT(store_id) DO UPDATE)
  - store_hours     (INSERT ... ON CONFLICT(store_id, day_of_week) DO UPDATE)

The store_google.store_id column is an INTEGER FK to stores.store_pk despite
its name — the store_pk integer value is bound, not the text store_id field.
"""

import logging
import sqlite3
from typing import Literal, Optional

from discover.hours import HoursRow, parse_opening_hours
from discover.types import PlaceDetails

logger = logging.getLogger(__name__)

IngestOutcome = Literal["inserted", "updated", "error"]


def ingest_store(
    conn: sqlite3.Connection,
    detail: PlaceDetails,
) -> tuple[IngestOutcome, int]:
    """Write one store to stores, store_google, and store_hours.

    Returns ('inserted'|'updated'|'error', store_pk).
    On error, the savepoint is rolled back and store_pk=0 is returned.
    """
    sp = "sp_store"
    try:
        conn.execute(f"SAVEPOINT {sp}")

        # Check if store already exists (to detect insert vs update)
        existing = conn.execute(
            """
            SELECT store_pk FROM stores
            WHERE store_name = ?
              AND (address = ? OR (address IS NULL AND ? IS NULL))
            """,
            (detail.display_name, detail.address, detail.address),
        ).fetchone()
        is_new = existing is None

        # Upsert into stores
        cursor = conn.execute(
            """
            INSERT INTO stores (
                store_id, store_name, store_type,
                address, city, state, zip,
                lat, lon, google_url, updated_at
            )
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(store_name, address) DO UPDATE SET
                google_url = excluded.google_url,
                updated_at = datetime('now')
            RETURNING store_pk
            """,
            (
                detail.display_name,
                detail.store_type,
                detail.address,
                detail.city,
                detail.state,
                detail.zip,
                detail.lat,
                detail.lon,
                detail.google_maps_uri,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError(
                f"RETURNING store_pk returned no row for '{detail.display_name}'"
            )
        store_pk: int = row[0]

        # Upsert into store_google
        # store_google.store_id is INTEGER FK to stores.store_pk (not text store_id)
        conn.execute(
            """
            INSERT INTO store_google (store_id, google_url, google_cid, last_seen_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(store_id) DO UPDATE SET
                google_url   = excluded.google_url,
                google_cid   = COALESCE(excluded.google_cid, store_google.google_cid),
                last_seen_at = datetime('now')
            """,
            (store_pk, detail.google_maps_uri, detail.google_cid),
        )

        # Upsert into store_hours
        hours_rows: list[HoursRow] = parse_opening_hours(detail.display_name, detail.hours_raw)
        for hr in hours_rows:
            conn.execute(
                """
                INSERT INTO store_hours (store_id, day_of_week, open_min, close_min)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(store_id, day_of_week) DO UPDATE SET
                    open_min  = excluded.open_min,
                    close_min = excluded.close_min
                """,
                (store_pk, hr.day_of_week, hr.open_min, hr.close_min),
            )

        conn.execute(f"RELEASE SAVEPOINT {sp}")
        outcome: IngestOutcome = "inserted" if is_new else "updated"
        return outcome, store_pk

    except Exception as exc:
        logger.warning("[skip] '%s': DB write failed — %s", detail.display_name, exc)
        try:
            conn.execute(f"ROLLBACK TO SAVEPOINT {sp}")
            conn.execute(f"RELEASE SAVEPOINT {sp}")
        except Exception:
            pass
        return "error", 0
