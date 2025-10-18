# Project: Multi-Day Thrift Route Planner (OPTW-lite)

See [CLI usage](rust-belt-cli-documentation.md) for command details and the
[trip schema](trip-schema.json) for input structure. Detailed requirements and
implementation guidance live in the [Route planner implementation
notes](route-planner-implementation.md).

## Problem Frame & Goals

- **Goal:** Build a planner that **maximizes number of stores visited per day** on
  a multi-day Detroit → Cleveland (overnight) → Buffalo (overnight) trip, with
  fixed daily start/end anchors and simple travel modeling.
- **Model:** A practical variant of the **Orienteering Problem** that respects
  store open hours. Per day: choose and order stops to maximize count under a
  daily time budget (drive + dwell) using **Haversine distance × constant mph**.
- **Key non-goal:** Shortest route. Efficiency is in service of **more stores
  while still reaching the hotel on time**.

## Milestone Roadmap

### v0.1 — Core Day-By-Day Planner (MVP) — Implemented

- Deterministic heuristic solver that segments trips into days, honors
  must-visit stores, and maximizes visit count under a daily time budget.
- Generates per-day itineraries with arrival/departure times, dwell, drive,
  slack, and summary metrics.

### v0.2 — Usability & Resilience — In progress

- Add tools for locking/pinning stops, re-optimizing mid-day, and reporting
  minimal relaxations when plans become infeasible.
- Surface richer diagnostics, including best-so-far progress updates.

### v0.3 — Power Controls & Robustness — Planned

- Introduce score-based objectives, daily caps, break windows, and optional
  spatial filters (corridor/polygon) to guide stop selection.
- Provide robustness controls that inflate travel time and expose **On-Time
  Risk** indicators.

### v0.4 — Explainability & Scenarios (Stretch) — Planned

- Save and compare scenarios while tracking differences in stops and key
  metrics.
- Explain why stores were excluded and highlight nearest alternatives.

## Out of Scope / De-scoped (for now)

- **FR-15** Spatial filter: corridor/polygon
- **FR-19** Turn-by-turn export / deep links
- **FR-23** Special cluster handling (keep exact-coordinate dedupe only)
- **FR-26**, **FR-27** Presets (nice-to-have future)
