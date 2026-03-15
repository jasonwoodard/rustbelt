# Rustbelt pipeline: storedb → Atlas → Solver
#
# Usage:
#   make score  BATCH=Florida-Set
#   make inject BATCH=Florida-Set TRIP=trips/florida-2026.json
#   make plan   BATCH=Florida-Set TRIP=trips/florida-2026.json DAY=2026-03-15
#   make help

DB     := storedb/rustbelt.db
LAMBDA := 0.6
OMEGA  := 0.5
MODE   := blended

.PHONY: help score inject plan

help:
	@echo ""
	@echo "Rustbelt pipeline targets:"
	@echo ""
	@echo "  make score  BATCH=<name>                        Export from storedb + run Atlas"
	@echo "  make inject BATCH=<name> TRIP=<path>            Inject Atlas scores into trip JSON"
	@echo "  make plan   BATCH=<name> TRIP=<path> DAY=<id>   Full pipeline: score → inject → solve"
	@echo ""
	@echo "Overridable defaults: LAMBDA=$(LAMBDA)  OMEGA=$(OMEGA)  MODE=$(MODE)  DB=$(DB)"
	@echo ""

## ─── score ─────────────────────────────────────────────────────────────────
# Exports stores/affluence/observations from storedb, runs Atlas blended
# scoring, writes results to out/<BATCH>/.

score:
ifndef BATCH
	$(error Usage: make score BATCH=<batch-name>)
endif
	@mkdir -p out/$(BATCH)
	@echo ""
	@echo "[1/3] Exporting from storedb (batch: $(BATCH))…"
	@sqlite3 $(DB) < storedb/build-run-views.sql
	@sqlite3 -csv -header $(DB) \
		"SELECT s.StoreId, s.Name, s.Type, s.Lat, s.Lon, s.GeoId \
		 FROM v_store_score_out s \
		 JOIN store_batches b ON s.StoreId = b.store_id \
		 WHERE b.batch_name = '$(BATCH)'" \
		> out/$(BATCH)/stores.csv
	@sqlite3 -csv -header $(DB) \
		"SELECT a.* FROM v_affluence_out a \
		 WHERE a.GeoId IN ( \
		     SELECT DISTINCT s.GeoId FROM v_store_score_out s \
		     JOIN store_batches b ON s.StoreId = b.store_id \
		     WHERE b.batch_name = '$(BATCH)' \
		 )" \
		> out/$(BATCH)/affluence.csv
	@sqlite3 -csv -header $(DB) \
		"SELECT \
		     COALESCE(NULLIF(s.store_id,''), printf('S%06d', s.store_pk)) AS StoreId, \
		     o.observed_at       AS DateTime, \
		     o.duration_min      AS DwellMin, \
		     o.item_purch_count  AS PurchasedItems, \
		     o.value_score       AS HaulLikert, \
		     o.observer          AS ObserverId, \
		     o.spend_usd         AS Spend, \
		     o.observe_notes     AS Notes \
		 FROM observations o \
		 JOIN stores s ON o.store_id = s.store_pk \
		 WHERE s.store_id IN ( \
		     SELECT b.store_id FROM store_batches b WHERE b.batch_name = '$(BATCH)' \
		 )" \
		> out/$(BATCH)/observations.csv
	@STORE_COUNT=$$(tail -n +2 out/$(BATCH)/stores.csv | wc -l | tr -d ' '); \
	 ZIP_COUNT=$$(tail -n +2 out/$(BATCH)/affluence.csv | wc -l | tr -d ' '); \
	 OBS_COUNT=$$(tail -n +2 out/$(BATCH)/observations.csv | wc -l | tr -d ' '); \
	 echo "      → out/$(BATCH)/stores.csv       ($$STORE_COUNT stores)"; \
	 echo "      → out/$(BATCH)/affluence.csv    ($$ZIP_COUNT ZIP codes)"; \
	 echo "      → out/$(BATCH)/observations.csv ($$OBS_COUNT observations)"
	@echo ""
	@echo "[2/3] Scoring with Atlas (mode=$(MODE), λ=$(LAMBDA), ω=$(OMEGA))…"
	@rustbelt-atlas score \
		--mode $(MODE) \
		--stores out/$(BATCH)/stores.csv \
		--affluence out/$(BATCH)/affluence.csv \
		--observations out/$(BATCH)/observations.csv \
		--output out/$(BATCH)/scored-stores.csv \
		--lambda $(LAMBDA) \
		--omega $(OMEGA) \
		--trace-out out/$(BATCH)/trace.jsonl
	@echo "      → out/$(BATCH)/scored-stores.csv"
	@echo "      → out/$(BATCH)/trace.jsonl"
	@echo ""
	@echo "[3/3] Done."
	@echo "      Next: make inject BATCH=$(BATCH) TRIP=<path/to/trip.json>"
	@echo ""

## ─── inject ─────────────────────────────────────────────────────────────────
# Merges Atlas Composite scores from scored-stores.csv into a trip JSON file.
# Writes a new file alongside the original with a -scored suffix.

inject:
ifndef BATCH
	$(error Usage: make inject BATCH=<batch-name> TRIP=<trip.json>)
endif
ifndef TRIP
	$(error Usage: make inject BATCH=<batch-name> TRIP=<trip.json>)
endif
	@python3 scripts/inject_scores.py \
		--scores out/$(BATCH)/scored-stores.csv \
		--trip $(TRIP) \
		--out $(basename $(TRIP))-scored.json

## ─── plan ────────────────────────────────────────────────────────────────────
# Full pipeline: score → inject → solve one day.
# Writes the scored trip JSON to <trip>-scored.json and prints the itinerary.

plan:
ifndef BATCH
	$(error Usage: make plan BATCH=<batch-name> TRIP=<trip.json> DAY=<day-id>)
endif
ifndef TRIP
	$(error Usage: make plan BATCH=<batch-name> TRIP=<trip.json> DAY=<day-id>)
endif
ifndef DAY
	$(error Usage: make plan BATCH=<batch-name> TRIP=<trip.json> DAY=<day-id>)
endif
	@$(MAKE) --no-print-directory score BATCH=$(BATCH)
	@$(MAKE) --no-print-directory inject BATCH=$(BATCH) TRIP=$(TRIP)
	@rustbelt solve-day \
		--trip $(basename $(TRIP))-scored.json \
		--day $(DAY) \
		--lambda $(LAMBDA)
