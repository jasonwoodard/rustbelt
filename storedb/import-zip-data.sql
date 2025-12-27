DROP TABLE IF EXISTS temp_zip_data;

CREATE TABLE IF NOT EXISTS "temp_zip_data" (
    "Geography" TEXT,
    "Geographic Area Name" TEXT,
    "Population" TEXT,
    " MedianIncome " TEXT,
    "Pct100kPlus" TEXT,
    "TotalSalaryPopulation" TEXT,
    "100k+" TEXT,
    "125Kk+" TEXT,
    "150k+" TEXT,
    "200k+" TEXT,
    " MedianHomeValue " TEXT,
    "PctRenter" TEXT,
    "TotalRentersPopulation" TEXT,
    "OwnerOccupied" TEXT,
    "RenterOccupied" TEXT,
    "PctBAPlus" TEXT
);


.mode CSV
.import --skip 1 import/rust_belt_zip_data.csv temp_zip_data

INSERT INTO zip_detail (
  zip,
  geoid,
  population,
  median_income,
  pct_100k_plus,
  pct_renter,
  renters_pop,
  pct_ba_plus
) 
SELECT 
  SUBSTR("Geographic Area Name", -5),
  "Geography",
  CAST(REPLACE("Population", ',', '') as INTEGER),
  CAST(
    REPLACE(
      REPLACE(
        REPLACE(" MedianIncome ", ',', ''),
        '$',
        ''
      ),
      ' ',
      ''
    ) as REAL
  ),
  CAST(REPLACE("Pct100kPlus", '%', '') as REAL),
  CAST(REPLACE("PctRenter", '%', '') as REAL),
  CAST(REPLACE("TotalRentersPopulation", ',', '') as INTEGER),
  CAST(REPLACE("PctBAPlus", '%', '') as REAL)
FROM temp_zip_data
WHERE true
ON CONFLICT(zip) DO UPDATE SET
  geoid             = excluded.geoid,
  --city,
  --state,
  --county_fips
  population        = excluded.population,
  median_income     = excluded.median_income,
  pct_100k_plus     = excluded.pct_100k_plus,
  pct_renter        = excluded.pct_renter,
  renters_pop       = excluded.renters_pop, 
  pct_ba_plus       = excluded.pct_ba_plus;
  --lat
  --long
