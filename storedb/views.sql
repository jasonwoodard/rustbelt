CREATE VIEW IF NOT EXISTS v_atlas_stores_min AS
SELECT
  i.atlas_id      AS id,
  s.name,
  s.lat,
  s.lon,
  s.zip,
  s.jscore_prior
FROM stores s
JOIN v_atlas_ids i ON i.store_pk = s.store_pk
WHERE s.lat IS NOT NULL AND s.lon IS NOT NULL;
