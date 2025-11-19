.mode csv

-- 1. EXPORT STORES DATA (atlas_store_input.csv)
.output ../packages/atlas-python/inputs/atlas_store_input.csv

-- Select all store details, filtering directly by the batch name in store_batches
SELECT s.*
FROM v_store_score_out AS s
JOIN store_batches AS b ON s.StoreId = b.store_id
WHERE b.batch_name = 'Detroit-Set'; -- <<< TARGET BATCH NAME HERE


-- 2. EXPORT AFFLUENCE DATA (atlas_affluence_input.csv)
.output ../packages/atlas-python/inputs/atlas_affluence_input.csv

SELECT
    a.*
FROM v_affluence_out AS a
WHERE
    -- GeoIds must be present in the subset of ZIP codes belonging to the targeted stores
    a.GeoId IN (
        SELECT DISTINCT
            s.GeoId
        FROM v_store_score_out AS s
        JOIN store_batches AS b ON s.StoreId = b.store_id
        WHERE b.batch_name = 'Detroit-Set' -- <<< REPEAT THE TARGET BATCH NAME HERE
    );

-- 3. RESET OUTPUT AND MODE
.output
.mode column