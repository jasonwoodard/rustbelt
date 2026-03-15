DROP VIEW IF EXISTS v_store_score_out;

CREATE VIEW IF NOT EXISTS v_store_score_out AS
SELECT
  COALESCE(NULLIF(store_id,''), printf('S%06d', store_pk)) AS StoreId,
  store_name AS Name,
  -- Map operational store_type values to Atlas canonical types.
  -- Atlas accepts: Thrift, Antique, Vintage, Flea/Surplus, Unknown.
  -- The DB owns this translation; Atlas carries no storedb knowledge.
  CASE store_type
    WHEN 'Thrift'       THEN 'Thrift'
    WHEN 'Antique'      THEN 'Antique'
    WHEN 'Vintage'      THEN 'Vintage'
    WHEN 'Flea/Surplus' THEN 'Flea/Surplus'
    WHEN 'Flea'         THEN 'Flea/Surplus'
    WHEN 'Surplus'      THEN 'Flea/Surplus'
    WHEN 'Junk'         THEN 'Thrift'
    ELSE                     'Unknown'
  END AS Type,
  lat AS Lat,
  lon AS Lon,
  store_note,
  CAST(zip AS TEXT) AS GeoId
FROM stores;


DROP VIEW IF EXISTS v_affluence_out;

CREATE VIEW IF NOT EXISTS v_affluence_out AS
SELECT
  CAST(zip as TEXT) as GeoId, 
  median_income as MedianIncome, 
  pct_100k_plus as Pct100kHH, 
  pct_ba_plus as Education,
  null as HomeValue,
  pct_renter as Turnover
FROM zip_detail;