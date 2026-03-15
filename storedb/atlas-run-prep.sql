-- Atlas export queries for the Makefile pipeline.
-- Executed by: make score BATCH=<name>
--
-- The Makefile calls each query individually with sqlite3 -csv -header,
-- routing output to out/<BATCH>/{stores,affluence,observations}.csv.
-- Do not run this file directly with sqlite3 < atlas-run-prep.sql.

-- [stores] Required by all Atlas scoring modes.
-- Columns: StoreId, Name, Type, Lat, Lon, GeoId
SELECT s.StoreId, s.Name, s.Type, s.Lat, s.Lon, s.GeoId
FROM v_store_score_out AS s
JOIN store_batches AS b ON s.StoreId = b.store_id
WHERE b.batch_name = :batch;

-- [affluence] Required for prior-only and blended modes.
-- Columns: GeoId, MedianIncome, Pct100kHH, Education, HomeValue, Turnover
SELECT a.*
FROM v_affluence_out AS a
WHERE a.GeoId IN (
    SELECT DISTINCT s.GeoId
    FROM v_store_score_out AS s
    JOIN store_batches AS b ON s.StoreId = b.store_id
    WHERE b.batch_name = :batch
);

-- [observations] Required for posterior-only and blended modes.
-- Columns: StoreId, DateTime, DwellMin, PurchasedItems, HaulLikert, ObserverId, Spend, Notes
SELECT
    COALESCE(NULLIF(s.store_id, ''), printf('S%06d', s.store_pk)) AS StoreId,
    o.observed_at    AS DateTime,
    o.duration_min   AS DwellMin,
    o.item_purch_count AS PurchasedItems,
    o.value_score    AS HaulLikert,
    o.observer       AS ObserverId,
    o.spend_usd      AS Spend,
    o.observe_notes  AS Notes
FROM observations o
JOIN stores s ON o.store_id = s.store_pk
WHERE s.store_id IN (
    SELECT b.store_id
    FROM store_batches b
    WHERE b.batch_name = :batch
);
