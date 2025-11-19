DROP VIEW IF EXISTS v_store_score_out;

CREATE VIEW IF NOT EXISTS v_store_score_out AS
SELECT
  COALESCE(NULLIF(store_id,''), printf('S%06d', store_pk)) AS StoreId,
  store_name as Name,
  store_type AS Type,
  lat as Lat,
  lon as Lon,
  store_note,
  CAST(zip as TEXT) as GeoId 
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