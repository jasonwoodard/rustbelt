"""Tests for discover.ingest — database write logic."""

import sqlite3
import textwrap

import pytest

from discover.ingest import ingest_store
from discover.types import PlaceDetails


SCHEMA = textwrap.dedent("""\
    PRAGMA foreign_keys = ON;
    CREATE TABLE stores (
        store_pk   INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id   TEXT UNIQUE,
        store_name TEXT NOT NULL,
        store_type TEXT,
        address    TEXT,
        city       TEXT,
        state      TEXT,
        zip        TEXT,
        lat        REAL,
        lon        REAL,
        jscore_prior REAL,
        store_note TEXT,
        google_url TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX stores_name_addr_uq ON stores(store_name, address);
    CREATE TABLE store_google (
        store_id     INTEGER PRIMARY KEY REFERENCES stores(store_pk) ON DELETE CASCADE,
        google_url   TEXT,
        google_cid   TEXT,
        rating       REAL,
        review_count INTEGER,
        last_seen_at TEXT
    );
    CREATE UNIQUE INDEX store_google_cid_uq ON store_google(google_cid);
    CREATE TABLE store_hours (
        store_id    INTEGER NOT NULL REFERENCES stores(store_pk) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        open_min    INTEGER,
        close_min   INTEGER,
        PRIMARY KEY (store_id, day_of_week)
    );
""")


def _make_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.isolation_level = None  # autocommit — savepoints handle per-store rollback
    conn.executescript(SCHEMA)
    return conn


def _make_detail(**overrides) -> PlaceDetails:
    defaults = dict(
        place_id="ChIJtest",
        display_name="Test Thrift",
        store_type="Thrift",
        formatted_address="123 Main St, Venice, FL 34285, USA",
        address="123 Main St",
        city="Venice",
        state="FL",
        zip="34285",
        lat=27.0998,
        lon=-82.4543,
        google_maps_uri="https://maps.google.com/?cid=999",
        google_cid="999",
        has_hours=True,
        hours_raw={
            "periods": [
                {"open": {"day": 1, "hour": 10, "minute": 0}, "close": {"day": 1, "hour": 17, "minute": 0}}
            ]
        },
    )
    defaults.update(overrides)
    return PlaceDetails(**defaults)


class TestIngestStore:
    def test_new_store_returns_inserted(self):
        conn = _make_db()
        detail = _make_detail()
        outcome, store_pk = ingest_store(conn, detail)
        assert outcome == "inserted"
        assert store_pk > 0

    def test_new_store_written_to_stores_table(self):
        conn = _make_db()
        detail = _make_detail()
        _, store_pk = ingest_store(conn, detail)
        row = conn.execute("SELECT store_name, store_type, zip FROM stores WHERE store_pk = ?", (store_pk,)).fetchone()
        assert row is not None
        assert row[0] == "Test Thrift"
        assert row[1] == "Thrift"
        assert row[2] == "34285"

    def test_new_store_has_null_store_id(self):
        """Discovered stores must have store_id=NULL (no slug assigned at import)."""
        conn = _make_db()
        _, store_pk = ingest_store(conn, _make_detail())
        row = conn.execute("SELECT store_id FROM stores WHERE store_pk = ?", (store_pk,)).fetchone()
        assert row[0] is None

    def test_new_store_google_row_written(self):
        conn = _make_db()
        _, store_pk = ingest_store(conn, _make_detail())
        row = conn.execute(
            "SELECT store_id, google_cid FROM store_google WHERE store_id = ?", (store_pk,)
        ).fetchone()
        assert row is not None
        assert row[0] == store_pk
        assert row[1] == "999"

    def test_new_store_hours_written(self):
        conn = _make_db()
        _, store_pk = ingest_store(conn, _make_detail())
        hours = conn.execute(
            "SELECT day_of_week, open_min, close_min FROM store_hours WHERE store_id = ? ORDER BY day_of_week",
            (store_pk,),
        ).fetchall()
        # regularOpeningHours present with Monday → 7 rows total
        assert len(hours) == 7
        monday_row = next(r for r in hours if r[0] == 0)
        assert monday_row[1] == 600   # 10:00
        assert monday_row[2] == 1020  # 17:00

    def test_existing_store_returns_updated(self):
        conn = _make_db()
        detail = _make_detail()
        ingest_store(conn, detail)
        outcome, _ = ingest_store(conn, detail)
        assert outcome == "updated"

    def test_existing_store_core_fields_untouched(self):
        """On conflict, store_type and other curated fields must not be overwritten."""
        conn = _make_db()
        detail = _make_detail(store_type="Thrift")
        _, store_pk = ingest_store(conn, detail)

        # Manually set store_type to a curated value
        conn.execute("UPDATE stores SET store_type = 'Antique' WHERE store_pk = ?", (store_pk,))

        # Re-ingest — store_type must remain 'Antique' (spec §8.1: leave untouched)
        detail2 = _make_detail(store_type="Vintage")
        ingest_store(conn, detail2)
        row = conn.execute("SELECT store_type FROM stores WHERE store_pk = ?", (store_pk,)).fetchone()
        assert row[0] == "Antique"

    def test_no_hours_when_hours_raw_is_none(self):
        conn = _make_db()
        detail = _make_detail(has_hours=False, hours_raw=None)
        _, store_pk = ingest_store(conn, detail)
        count = conn.execute(
            "SELECT COUNT(*) FROM store_hours WHERE store_id = ?", (store_pk,)
        ).fetchone()[0]
        assert count == 0

    def test_store_google_pk_is_integer_fk(self):
        """store_google.store_id must be the integer store_pk, not a text code."""
        conn = _make_db()
        _, store_pk = ingest_store(conn, _make_detail())
        row = conn.execute(
            "SELECT store_id FROM store_google WHERE store_id = ?", (store_pk,)
        ).fetchone()
        assert row is not None
        assert isinstance(row[0], int)
        assert row[0] == store_pk
