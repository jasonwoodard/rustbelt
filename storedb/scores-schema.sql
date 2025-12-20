CREATE TABLE IF NOT EXISTS score_types (
  score_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,   -- 'G_RATING', 'J_PRIOR', 'J_POST', 'ATLAS_VALUE', 'ATLAS_YIELD'
  name            TEXT NOT NULL,          -- human label
  source          TEXT NOT NULL,          -- 'Google', 'Manual', 'Atlas'
  dimension       TEXT,                   -- 'value','yield','quality','risk'...
  scale_desc      TEXT,                   -- e.g. '0-5 stars', '0-10 normalized', 'logit', etc.
  higher_is_better INTEGER NOT NULL DEFAULT 1 CHECK (higher_is_better IN (0,1)),
  notes           TEXT
);

INSERT INTO score_types (cods, name, source, dimension, scale_desc, higher_is_better)
SELECT 'GScore', 'Google Maps Rating', 'Google', 'Community Rating', '1 - 5 Stars', TRUE;

INSERT INTO score_types (cods, name, source, dimension, scale_desc, higher_is_better)
SELECT 'GScore-LowK', 'Google Maps Rating', 'Google', 'Low K Smoothed Community Rating', '1 - 5 Stars', TRUE;

INSERT INTO score_types (cods, name, source, dimension, scale_desc, higher_is_better)
SELECT 'GScore-HighK', 'Google Maps Rating', 'Google', 'Low K Smoothed Community Rating', '1 - 5 Stars', TRUE;

INSERT INTO score_types (cods, name, source, dimension, scale_desc, higher_is_better)
SELECT 'JScore', 'Jason Score', 'Manual', 'Jason\'s desire to go there', '0 - 5 Stars', TRUE


CREATE TABLE IF NOT EXISTS store_scores (
  score_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  store_pk        INTEGER NOT NULL REFERENCES stores(store_pk) ON DELETE CASCADE,
  score_type_id   INTEGER NOT NULL REFERENCES score_types(score_type_id),
  value           REAL NOT NULL,

  -- WHEN this score is about
  effective_date  TEXT,          -- date/run this score describes (e.g. date of Atlas run or Google scrape)
  observed_at     TEXT NOT NULL DEFAULT (datetime('now')),  -- when *you* recorded it
  run_id          TEXT,          -- 'ATLAS-AA-v1', 'ATLAS-DET-v3.2', 'GSCRAPE-2025-09-10'
  model_version   TEXT,          -- 'atlas-0.3.1-lambda0.1', 'manual-2025-09', etc.
  
  -- Optional “context” fields
  n_observations  INTEGER,       -- e.g. GRevCount, or number of trips used in Atlas
  params_json     TEXT,          -- json blob of parameters: {"lambda":0.1,"k":"low"}
  note            TEXT
);

CREATE INDEX IF NOT EXISTS store_scores_store_idx ON store_scores(store_pk);
CREATE INDEX IF NOT EXISTS store_scores_type_idx  ON store_scores(score_type_id);
CREATE INDEX IF NOT EXISTS store_scores_run_idx   ON store_scores(run_id);
