DROP TABLE IF EXISTS temp_scores_raw;

CREATE TABLE temp_scores_raw (
  store_id       TEXT,
  g_rating       REAL,
  g_revcount     INTEGER,
  j_prior        REAL,
  j_post         REAL,
  g_lowk         REAL,
  g_highk        REAL
);


.mode csv

.import --skip 1 import/rb-scores-stage.csv temp_scores_raw

DROP VIEW IF EXISTS temp_scores_mapped;

CREATE VIEW temp_scores_mapped AS
SELECT
  s.store_pk,
  r.*
FROM temp_scores_raw r
JOIN stores s ON s.store_id = r.store_id;

/* LOOK FOR MISSING
SELECT r.*
FROM temp_scores_raw r
LEFT JOIN stores s ON s.store_id = r.store_id
WHERE s.store_pk IS NULL;
*/

-- IMPORT GScore
INSERT INTO store_scores (store_pk, score_type_id, value, effective_date, n_observations, note)
SELECT
  m.store_pk,
  st.score_type_id,
  m.g_rating,
  date('2025-09-15'),             
  m.g_revcount,
  'Imported from Sheet'
FROM temp_scores_mapped m
JOIN score_types st ON st.code = 'G_RATING'
WHERE m.g_rating IS NOT NULL
ON CONFLICT(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''))
DO UPDATE SET 
  value          = excluded.value,
  n_observations = excluded.n_observations,
  note           = COALESCE(excluded.note, store_scores.note),
  observed_at    = datetime('now');

-- IMPORT G-Low/High K scores
INSERT INTO store_scores (store_pk, score_type_id, value, effective_date, n_observations, note)
SELECT
  m.store_pk,
  st.score_type_id,
  m.g_lowk,
  date('2025-09-15'),
  m.g_revcount,
  'Imported G Low-K'
FROM temp_scores_mapped m
JOIN score_types st ON st.code = 'G_LOWK'
WHERE m.g_lowk IS NOT NULL
ON CONFLICT(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''))
DO UPDATE SET 
  value          = excluded.value,
  n_observations = excluded.n_observations,
  note           = COALESCE(excluded.note, store_scores.note),
  observed_at    = datetime('now');


INSERT INTO store_scores (store_pk, score_type_id, value, effective_date, n_observations, note)
SELECT
  m.store_pk,
  st.score_type_id,
  m.g_highk,
  date('2025-09-15'),
  m.g_revcount,
  'Imported G High-K'
FROM temp_scores_mapped m
JOIN score_types st ON st.code = 'G_HIGHK'
WHERE m.g_highk IS NOT NULL
ON CONFLICT(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''))
DO UPDATE SET 
  value          = excluded.value,
  n_observations = excluded.n_observations,
  note           = COALESCE(excluded.note, store_scores.note),
  observed_at    = datetime('now');


-- IMPORT JScore Prior / Posterior
INSERT INTO store_scores (store_pk, score_type_id, value, effective_date, note)
SELECT
  m.store_pk,
  st.score_type_id,
  m.j_prior,
  date('now'),
  'Imported JScore prior'
FROM temp_scores_mapped m
JOIN score_types st ON st.code = 'J_PRIOR'
WHERE m.j_prior IS NOT NULL
ON CONFLICT(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''))
DO UPDATE SET 
  value          = excluded.value,
  note           = COALESCE(excluded.note, store_scores.note),
  observed_at    = datetime('now');


INSERT INTO store_scores (store_pk, score_type_id, value, effective_date, note)
SELECT
  m.store_pk,
  st.score_type_id,
  m.j_post,
  date('now'),
  'Imported JScore post'
FROM temp_scores_mapped m
JOIN score_types st ON st.code = 'J_POST'
WHERE m.j_post IS NOT NULL
ON CONFLICT(store_pk, score_type_id, COALESCE(run_id,''), COALESCE(effective_date,''))
DO UPDATE SET 
  value          = excluded.value,
  note           = COALESCE(excluded.note, store_scores.note),
  observed_at    = datetime('now');

