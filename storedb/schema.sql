PRAGMA foreign_keys = ON;

-- Core store record (single source of truth)
CREATE TABLE IF NOT EXISTS stores (
  store_pk       INTEGER PRIMARY KEY AUTOINCREMENT,  -- surrogate PK
  store_id       TEXT UNIQUE,             -- short ID: 'AAPTS', 'PG', etc.
  store_name     TEXT NOT NULL,
  store_type     TEXT,                         -- Antique/Thrift/Surplus/Vintage/Nautical/Flea/Junk/Boutique/Furniture/Sports/Discount
  address        TEXT,
  city           TEXT, 
  state          TEXT, 
  zip            TEXT,
  lat            REAL, 
  lon            REAL,
  jscore_prior   REAL,                         -- JScore prior
  store_note     TEXT,                         -- Store Notes
  google_url     TEXT,
  updated_at     TEXT DEFAULT (datetime('now')) -- Create / Update date time for store entry
);

-- Google metadata kept separate so it's easy to refresh without touching 'stores'
CREATE TABLE IF NOT EXISTS store_google (
  store_id   INTEGER PRIMARY KEY REFERENCES stores(store_pk) ON DELETE CASCADE,
  google_url     TEXT,
  google_cid     TEXT,                         -- if you can parse cid=... from url
  rating         REAL,                         -- GScore
  review_count   INTEGER,                      -- GRevCount
  last_seen_at   TEXT                          -- when you last copied it
);

-- Canonical hours per store (normalized)
-- 0=Mon .. 6=Sun, times as minutes since midnight (NULL means closed)
CREATE TABLE IF NOT EXISTS store_hours (
  store_id   INTEGER NOT NULL REFERENCES stores(store_pk) ON DELETE CASCADE,
  day_of_week      INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_min       INTEGER,                      -- e.g., 10:00 -> 600
  close_min      INTEGER,                      -- e.g., 17:00 -> 1020
  PRIMARY KEY (store_id, day_of_week)
);

-- Observations ("Actual"): visits, outcomes, findings
CREATE TABLE IF NOT EXISTS observations (
  obs_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores(store_pk) ON DELETE CASCADE,
  observed_at    TEXT NOT NULL,                -- ISO timestamp or date
  value_score    REAL,                         -- How good is the stuff? (1-5)
  duration_min   INTEGER,                      -- Time spent in store (minutes)
  item_purch_count INTEGER,                -- How many items did you purchase?
  observe_notes  TEXT,                         -- quick notes ("found: X, Y")
  spend_usd      REAL,                         -- Spend ($ USD) optional
  tags_csv       TEXT,                          -- lightweight structured tags, e.g. "nautical,mid-century"
  observer       TEXT                         -- Who made the observation? Expect email or username
);

-- ZIP/ZCTA enrichment (optional; populate as you expand)
CREATE TABLE IF NOT EXISTS zip_detail (
  zip            TEXT PRIMARY KEY,
  geoid          TEXT,
  city           TEXT,
  state          TEXT,
  county_fips    TEXT,
  population     INTEGER,
  median_income  INTEGER,
  pct_100k_plus  REAL,
  pct_renter     REAL,
  renters_pop    INTEGER,
  pct_ba_plus    REAL,
  lat            REAL, 
  lon            REAL
);


-- Indexes
CREATE INDEX IF NOT EXISTS stores_type_idx  ON stores(store_type);
CREATE INDEX IF NOT EXISTS stores_geo_idx ON stores(lat, lon);
CREATE UNIQUE INDEX IF NOT EXISTS stores_name_addr_uq ON stores(store_name, address);
CREATE UNIQUE INDEX IF NOT EXISTS store_google_cid_uq ON store_google(google_cid);
CREATE INDEX IF NOT EXISTS obs_store_date_idx ON observations(store_id, observed_at);
CREATE INDEX IF NOT EXISTS zip_state_idx  ON zip_detail(state);

