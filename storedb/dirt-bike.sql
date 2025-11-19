/*
SELECT json_group_array(json_object(
     'id',   id,
     'name', store_name,
     'lat',  lat,
     'lon',  lon,
     'zip',  zip,
     'jscore', jscore_prior
   ))
   FROM v_atlas_stores_min; > trip-stores-min.json

*/

-- How many stores now have hours?
SELECT COUNT(DISTINCT store_id) FROM store_hours;

-- Spot check one store by name
SELECT s.store_name, h.day_of_week, h.open_min, h.close_min
FROM store_hours h
JOIN stores s ON s.store_pk = h.store_id
WHERE s.store_name LIKE '%Amelia%';

-- Which hours rows are "closed"
SELECT * FROM store_hours WHERE open_min IS NULL AND close_min IS NULL LIMIT 20;

-- CID coverage
SELECT COUNT(*) AS with_cid
FROM store_google
WHERE google_cid IS NOT NULL AND google_cid <> '';
