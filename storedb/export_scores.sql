-- export_latest.sql
.headers on
.mode csv
.output export/atlas_store_scores_latest.csv

SELECT * FROM v_store_scores_latest;

.output stdout