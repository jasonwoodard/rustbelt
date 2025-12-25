DROP TABLE IF EXISTS score_types;

CREATE TABLE IF NOT EXISTS score_types (
  score_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,   -- 'G_RATING', 'J_PRIOR', 'J_POST', 'ATLAS_VALUE', 'ATLAS_YIELD'
  name            TEXT NOT NULL,          -- human label
  source_system   TEXT NOT NULL,          -- 'Google', 'Manual', 'Atlas'
  dimension       TEXT,                   -- 'value','yield','quality','risk'...
  scale_desc      TEXT,                   -- e.g. '0-5 stars', '0-10 normalized', 'logit', etc.
  higher_is_better INTEGER NOT NULL DEFAULT 1 CHECK (higher_is_better IN (0,1)),
  notes           TEXT
);

INSERT OR IGNORE INTO score_types (code, name, source_system, dimension, scale_desc)
VALUES
  ('G_RATING',    'Google Maps Rating', 'Google', 'Google Community Rating',  '0–5 stars'),
  ('G_RATING_COUNT', 'Google Maps Rating Count', 'Google', 'Google Community Rating Count',  'Rating Count'),
  ('G_LOWK',      'Google Maps Low-K Rating',   'Sheet',  'Google Community Rating',  '0–5 stars (low K)'),
  ('G_HIGHK',     'Google Maps High-K Rating',  'Sheet',  'Google Community Rating',  '0–5 stars (high K)'),
  ('J_PRIOR',     'JScore Prior',          'Manual', 'Jason Want to Got There',  'Custom 0–5'),
  ('J_POST',      'JScore Posterior',      'Manual', 'value',  'Custom 0–5'),
  ('ATLAS_VALUE', 'Atlas Value',           'Atlas',  'value',  'Normalized'),
  ('ATLAS_YIELD', 'Atlas Yield',           'Atlas',  'yield',  'Normalized');


DROP TABLE IF EXISTS store_scores;

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
CREATE UNIQUE INDEX IF NOT EXISTS store_scores_uq
ON store_scores(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''));


CREATE VIEW IF NOT EXISTS v_store_scores_latest AS
WITH latest AS (
  SELECT
    store_pk,
    score_type_id,
    MAX(effective_date || 'T' || substr(observed_at,12)) AS maxkey
  FROM store_scores
  GROUP BY store_pk, score_type_id
)
SELECT
  s.store_id,
  s.store_name,
  s.store_type,

  MAX(CASE
        WHEN st.code = 'G_RATING'
         AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
        THEN sc.value
      END) AS G_Rating,

  MAX(CASE
        WHEN st.code = 'G_RATING'
         AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
        THEN sc.n_observations
      END) AS G_RevCount,
  
    MAX(CASE
        WHEN st.code = 'G_LOWK'
        AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
        THEN sc.value
      END) AS G_LowK,

    MAX(CASE
          WHEN st.code = 'G_LOWK'
          AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
          THEN sc.n_observations
        END) AS G_LowK_RevCount,

    MAX(CASE
          WHEN st.code = 'G_HIGHK'
          AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
          THEN sc.value
        END) AS G_HighK,

    MAX(CASE
          WHEN st.code = 'G_HIGHK'
          AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
          THEN sc.n_observations
        END) AS G_HighK_RevCount,

      MAX(CASE
        WHEN st.code = 'J_PRIOR'
         AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
        THEN sc.value
      END) AS J_Prior,

      MAX(CASE
            WHEN st.code = 'J_POST'
            AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
            THEN sc.value
          END) AS J_Post,

     MAX(CASE
          WHEN st.code = 'ATLAS_VALUE'
          AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
          THEN sc.value
        END) AS Atlas_Value,

      MAX(CASE
            WHEN st.code = 'ATLAS_YIELD'
            AND l.maxkey = sc.effective_date || 'T' || substr(sc.observed_at,12)
            THEN sc.value
          END) AS Atlas_Yield

FROM stores s
LEFT JOIN store_scores sc ON sc.store_pk = s.store_pk
LEFT JOIN score_types st  ON st.score_type_id = sc.score_type_id
LEFT JOIN latest l
  ON l.store_pk = sc.store_pk
 AND l.score_type_id = sc.score_type_id
GROUP BY s.store_pk;

