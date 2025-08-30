# Rust Belt Multi-Day Test Plan

This document outlines a manual test plan for a four-state thrift route across Michigan, Ohio, Pennsylvania, and New York. The dataset contains **132 stores across 97 ZIP codes**. The trip spans three travel days:

- **Day 1 – Detroit local loop**
- **Day 2 – Detroit → Toledo → Cleveland**
- **Day 3 – Cleveland → Erie → Buffalo**

The steps below exercise the CLI, verify itinerary outputs, and ensure no store is visited twice.

---

## 1. Prepare Data

1. Build a trip JSON (`trips/rust-belt.json`) with:
   - Three `dayId` entries with start/end anchors and time windows matching the legs above.
   - A `stores` array containing all 132 stores with unique `id` values. Optionally assign a `dayId` to restrict a store to a single day; stores without a `dayId` are candidates on every day. Stores should appear **only once** in the file.
2. Optional: group stores roughly by geography to balance the daily workload (e.g., Detroit downtown vs. suburbs).
3. Validate the JSON with `jq` or the provided schema (`docs/trip-schema.json`) before solving.

```bash
jq . trips/rust-belt.json >/dev/null
# ajv validate -s docs/trip-schema.json -d trips/rust-belt.json
```

---

## 2. Day-by-Day Runs

Run the solver separately for each day. Use a fixed seed for reproducibility and the same average speed and dwell unless testing overrides. Include `--csv` to capture a stop summary or `--kml` for a map view if desired.

### Day 1 – Detroit Loop

```bash
rustbelt solve-day \
  --trip trips/rust-belt.json \
  --day 2025-07-01 \
  --mph 30 \
  --default-dwell 12 \
  --seed 1 \
  --out plans/day1.json \
  --csv plans/day1.csv
```

**Expected checks**
- Itinerary contains only Detroit stores assigned to Day 1.
- `storeCount` ≤ Detroit candidate count.
- Slack is non‑negative; hotel ETA ≤ day end.

### Day 2 – Detroit → Toledo → Cleveland

```bash
rustbelt solve-day \
  --trip trips/rust-belt.json \
  --day 2025-07-02 \
  --mph 30 \
  --default-dwell 12 \
  --seed 1 \
  --out plans/day2.json
```

**Expected checks**
- No store IDs from Day 1 appear in the Day 2 itinerary.
- Drive time roughly increases after the Detroit segment.
- Arrival at the Cleveland hotel occurs before the window closes.

### Day 3 – Cleveland → Erie → Buffalo

```bash
rustbelt solve-day \
  --trip trips/rust-belt.json \
  --day 2025-07-03 \
  --mph 30 \
  --default-dwell 12 \
  --seed 1 \
  --out plans/day3.json \
  --kml plans/day3.kml
```

**Expected checks**
- Itinerary covers stores from Cleveland through Buffalo only.
- No duplicates from earlier days.
- Final stop is the Buffalo hotel with feasible slack.

---

## 3. Re‑optimization Scenario (Day 2)

To exercise mid‑day re‑solve, pretend the traveler is in Toledo at 13:30 after visiting two stores:

```bash
rustbelt solve-day \
  --trip trips/rust-belt.json \
  --day 2025-07-02 \
  --now 13:30 \
  --at 41.6639,-83.5552 \
  --done s_021,s_045 \
  --seed 1 \
  --out plans/day2-reopt.json \
  --csv plans/day2-reopt.csv
```

Verify that:
- Completed store IDs are excluded.
- Remaining itinerary starts from the Toledo coordinates.
- End-of-day hotel remains in Cleveland.

---

## 4. Avoiding Duplicate Visits

1. **Unique IDs** – ensure every store has a unique `id` in the trip file. The parser rejects duplicates.
2. **Day assignment** – If you use `dayId`s, assign each store to at most one day. For stores without a `dayId`, run a post‑solve check that aggregates `storeId`s from `plans/day*.json` and flags duplicates:

```bash
jq -r '.itinerary[].id' plans/day{1,2,3}.json | sort | uniq -d
```

3. **Re‑optimization** – when re‑solving mid‑day, pass already visited IDs with `--done` so they cannot be revisited.
4. **Exact-coordinate dedupe** – the parser already removes stores with identical lat/lon; verify this once per dataset:

```bash
jq -r '.stores[] | "\(.lat),\(.lon)"' trips/rust-belt.json | sort | uniq -d
```

---

## 5. Additional Considerations

- **Performance** – with 132 stores the solver should finish quickly; investigate if runtime exceeds a minute.
- **Random Seed** – change `--seed` to explore alternate itineraries while keeping determinism per seed.
- **Objective blending** – experiment with `--lambda` to favor higher-score stores once scores are populated.
- **Robustness factor** – `--robustness` > 1 inflates drive times and reduces slack.
- **Risk view** – use `--risk-threshold` to highlight legs with slack below a chosen buffer.

---

## 6. Validation Steps

After generating plans, run basic validation:

```bash
jq '.summary.storeCount' plans/day1.json plans/day2.json plans/day3.json
```

Ensure counts sum to ≤132 and there are no duplicate IDs. Review `slackMin` and `totalDriveMin` for reasonableness.

---

## 7. Cleanup

Store the generated plan files under `plans/` or discard them after review. Keep the trip JSON under version control for future regression testing.

