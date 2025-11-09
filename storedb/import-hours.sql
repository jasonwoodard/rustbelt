-- Drop any prior staging
DROP TABLE IF EXISTS temp_hours;

-- Staging: keep columns you have
CREATE TABLE temp_hours (
  store_id        TEXT,
  store_name      TEXT,
  store_address   TEXT,
  monday_hours    TEXT,
  tuesday_hours   TEXT,
  wednesday_hours TEXT,
  thursday_hours  TEXT,
  friday_hours    TEXT,
  saturday_hours  TEXT,
  sunday_hours    TEXT,
  google_url      TEXT,
  hours_json      TEXT
);

.mode csv
.import --skip 1 import/rb-hours.csv temp_hours

-- Helper view to parse cid from google_url
DROP VIEW IF EXISTS temp_hours_cid;

CREATE VIEW temp_hours_cid AS
SELECT
  *,
  CASE
    WHEN google_url IS NULL OR instr(google_url, 'cid=') = 0 THEN NULL
    ELSE
      /* start after 'cid=' */
      substr(
        google_url,
        instr(google_url, 'cid=') + 4,
        CASE
          /* length up to next '&' if present, otherwise to end */
          WHEN instr(substr(google_url, instr(google_url,'cid=') + 4), '&') > 0
          THEN instr(substr(google_url, instr(google_url,'cid=') + 4), '&') - 1
          ELSE length(google_url) - (instr(google_url,'cid=') + 3)
        END
      )
  END AS google_cid_extracted
FROM temp_hours;

-- Upsert stores by store_ID if present 
-- don’t overwrite curated fields you don't have here
INSERT INTO stores AS s  (
  store_id, 
  store_name, 
  updated_at
)
SELECT DISTINCT 
  NULLIF(trim(thcid.store_id),''),            -- keep NULL if blank
  NULLIF(trim(thcid.store_name),''),
  datetime('now')
FROM temp_hours_cid thcid
WHERE NULLIF(trim(thcid.store_id),'') IS NOT NULL
   OR NULLIF(trim(thcid.store_name),'') IS NOT NULL
   AND TRUE
ON CONFLICT(store_id) DO UPDATE SET
  updated_at = excluded.updated_at;

DROP VIEW IF EXISTS temp_hours_storepk;

CREATE VIEW temp_hours_storepk AS
SELECT
  h.*,
  s.store_pk
FROM temp_hours_cid h
LEFT JOIN stores s
  ON s.store_id = h.store_id;

-- Insert/Update Google metadata for mapped rows
INSERT INTO store_google
  (store_id, google_url, google_cid, last_seen_at)
SELECT DISTINCT
  hs.store_pk,
  NULLIF(trim(hs.google_url),''),
  NULLIF(trim(hs.google_cid_extracted),''),
  datetime('now')
FROM temp_hours_storepk hs
WHERE hs.store_pk IS NOT NULL
ON CONFLICT(store_id) DO UPDATE SET
  google_url   = COALESCE(excluded.google_url, store_google.google_url),
  google_cid   = COALESCE(excluded.google_cid, store_google.google_cid),
  last_seen_at = excluded.last_seen_at;


DROP VIEW IF EXISTS temp_hours_json_flat;

CREATE VIEW temp_hours_json_flat AS
WITH j AS (
  SELECT
    hs.store_pk,
    json_extract(hs.hours_json, '$.openHours.mon') AS mon,
    json_extract(hs.hours_json, '$.openHours.tue') AS tue,
    json_extract(hs.hours_json, '$.openHours.wed') AS wed,
    json_extract(hs.hours_json, '$.openHours.thu') AS thu,
    json_extract(hs.hours_json, '$.openHours.fri') AS fri,
    json_extract(hs.hours_json, '$.openHours.sat') AS sat,
    json_extract(hs.hours_json, '$.openHours.sun') AS sun
  FROM temp_hours_storepk hs
  WHERE hs.store_pk IS NOT NULL
)
SELECT store_pk, 0 AS dow, mon AS arr FROM j UNION ALL
SELECT store_pk, 1, tue FROM j UNION ALL
SELECT store_pk, 2, wed FROM j UNION ALL
SELECT store_pk, 3, thu FROM j UNION ALL
SELECT store_pk, 4, fri FROM j UNION ALL
SELECT store_pk, 5, sat FROM j UNION ALL
SELECT store_pk, 6, sun FROM j;

-- Insert hours rows (first interval if any; else NULLs = closed)
INSERT INTO store_hours AS h (store_id, day_of_week, open_min, close_min)
SELECT
  f.store_pk,
  f.dow,
  CASE
    WHEN json_array_length(f.arr) = 0 THEN NULL
    ELSE
      /* open_min from $[0][0] like "10:00" */
      CAST(substr(json_extract(f.arr, '$[0][0]'),1,2) AS INT) * 60
      + CAST(substr(json_extract(f.arr, '$[0][0]'),4,2) AS INT)
  END AS open_min,
  CASE
    WHEN json_array_length(f.arr) = 0 THEN NULL
    ELSE
      CAST(substr(json_extract(f.arr, '$[0][1]'),1,2) AS INT) * 60
      + CAST(substr(json_extract(f.arr, '$[0][1]'),4,2) AS INT)
  END AS close_min
FROM temp_hours_json_flat f
WHERE TRUE
ON CONFLICT(store_id, day_of_week) DO UPDATE SET
  open_min  = excluded.open_min,
  close_min = excluded.close_min;

