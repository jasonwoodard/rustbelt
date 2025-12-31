.headers off
.mode list
.separator "\n"
.output export/zips_union.txt


WITH all_zips AS (
  SELECT DISTINCT SUBSTR(TRIM(zip),1,5) AS zip5, 1 AS priority
  FROM stores
  WHERE zip IS NOT NULL AND TRIM(zip) <> ''

  UNION

  SELECT DISTINCT SUBSTR(TRIM(zip),1,5) AS zip5, 2 AS priority
  FROM zip_detail
  WHERE zip IS NOT NULL AND TRIM(zip) <> ''
)
SELECT zip5
FROM all_zips
WHERE LENGTH(zip5)=5
  AND zip5 GLOB '[0-9][0-9][0-9][0-9][0-9]'
ORDER BY priority, zip5;

.output
.mode column
