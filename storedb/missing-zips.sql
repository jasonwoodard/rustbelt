.mode csv

.headers off

.output export/missing_zips.txt

SELECT DISTINCT SUBSTR(TRIM(s.zip), 1, 5)
FROM stores s
LEFT JOIN zip_detail z ON z.zip = SUBSTR(TRIM(s.zip), 1, 5)
WHERE s.zip IS NOT NULL AND TRIM(s.zip) <> '' AND z.zip IS NULL;

.output
