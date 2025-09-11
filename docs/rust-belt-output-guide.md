# Rust Belt Output Guide

This page explains how to interpret the JSON produced by `rustbelt solve-day` and how configuration options influence the itinerary. The examples reference the sample output below.

```json
{
  "runTimestamp": "2025-09-11T03:08:45.285Z",
  "days": [
    { "dayId": "Clev-Buff", "stops": [...], "metrics": { ... } }
  ]
}
```

## Top-level fields

- **`runTimestamp`** – The ISO timestamp for when the solver generated the plan. It helps track when the itinerary was last refreshed.
- **`days`** – An array of solved days. Each entry contains a `dayId`, an ordered list of `stops`, and a `metrics` summary.

## Stops

Each element in the `stops` array represents a location in the itinerary. Fields include:

- `id`, `name`, and `type` (`start`, `store`, or `end`).
- `arrive` and `depart` times in local time.
- Geographic coordinates `lat` and `lon`.
- Optional `dwellMin` showing minutes planned at the stop.
- Optional `legIn` describing the leg from the previous stop: `fromId`, `toId`, `driveMin`, and `distanceMi`.
- Store-specific values such as `score` and `tags`.

### Example: Antiques & Uniques (`AU`)

```json
{
  "id": "AU",
  "name": "Antiques & Uniques",
  "type": "store",
  "arrive": "09:39",
  "depart": "10:09",
  "dwellMin": 30,
  "legIn": {
    "fromId": "CRCATAs",
    "toId": "AU",
    "driveMin": 38.75,
    "distanceMi": 22.60
  },
  "score": 4.8,
  "tags": ["must-visit", "Antique"]
}
```
The solver expects a 38‑minute drive from the start location to the store and schedules a 30‑minute dwell. The `score` reflects store quality; higher values make a stop more desirable when optimizing.

### Example: Savers (`SAVERSB`)

This later stop arrives at 17:11 after a 56‑minute drive. The high `score` of 4.8 and `Thrift` tag indicate a priority thrift store. Comparing stops helps identify where long drives occur or which stores contribute most to the total score.

## Metrics

The `metrics` block summarizes the solved day:

```json
{
  "storesVisited": 7,
  "totalScore": 29.7,
  "totalDriveMin": 325.60,
  "totalDwellMin": 210,
  "slackMin": 4.40,
  "onTimeRisk": 0.125
}
```

- **`storesVisited`** – Number of store stops completed.
- **`totalScore`** – Sum of `score` values for all store stops.
- **`totalDriveMin`** – Minutes spent driving between stops.
- **`totalDwellMin`** – Planned time inside stores.
- **`slackMin`** – Unused minutes in the schedule. Low slack means the day is tightly packed.
- **`onTimeRisk`** – Fraction of legs with slack below the configured risk threshold. A higher value indicates more chance of falling behind schedule.

Use these numbers to gauge itinerary efficiency and feasibility. For example, a high `totalDriveMin` with low `storesVisited` may suggest the stores are too far apart, while minimal `slackMin` combined with `onTimeRisk` above `0` signals a schedule that may be hard to keep.

## Tuning the Solver

Configuration settings and CLI flags let you refine the output:

- **Travel speed (`--mph` or `config.mph`)** – Adjust to match expected driving conditions. Lowering the value increases `driveMin` in `legIn` and `totalDriveMin` in `metrics`.
- **Default dwell time (`--default-dwell`)** – Sets how long the solver assumes you spend at each store. Increasing it boosts `dwellMin` for unspecified stops and raises `totalDwellMin`.
- **Objective weight (`--lambda`)** – Chooses between maximizing stop count (`0`) or total score (`1`). Intermediate values balance the two. A higher lambda typically increases `totalScore` at the expense of `storesVisited`.
- **Random seed (`--seed`)** – Reproduce or diversify itineraries. Different seeds may explore alternate routes or store combinations.
- **Robustness factor (`--robustness`)** – Multiplies drive times to account for traffic or uncertainty. Raising the factor inflates `driveMin` and can reduce the number of stops that fit in the day.
- **Risk threshold (`--risk-threshold`)** – Specifies the slack limit used to compute `onTimeRisk`. Raising it flags more legs as risky, encouraging itineraries with larger buffers.

### Common Scenarios

- **Maximize store variety:** Use a low `--lambda` to prioritize hitting as many stops as possible.
- **Focus on top stores:** Set `--lambda` near `1` so the solver favors high‑scoring locations even if fewer stores fit.
- **Plan for traffic:** Increase `--robustness` or lower `--mph` to create conservative drive estimates, then check that `onTimeRisk` remains acceptable.
- **Short browsing windows:** Reduce `--default-dwell` when you plan quick visits, freeing more time for additional stops.

By interpreting the `metrics` and experimenting with configuration options, you can iteratively refine trips to match real‑world constraints and preferences.

## Understanding Schedule Risk

Two pieces work together to describe how likely you are to fall behind schedule:

- **`--risk-threshold`** – a CLI/config option in minutes. Each leg that arrives with less slack than this value is considered "at risk." The default is `0`, which effectively disables risk tracking because slack is almost always greater than zero.
- **`onTimeRisk`** – fraction of legs marked at risk. It is *not* the probability of failure, but a share of the itinerary that has little buffer.

### How `onTimeRisk` is computed

For every leg, the solver looks at how many minutes remain before the day's end after you arrive at the next stop. If that remaining slack is below the threshold, the leg is counted as risky. `onTimeRisk` is simply `riskyLegs / totalLegs`.

In the example itinerary above, there are eight legs. With a threshold of `15` minutes, one leg finishes with less than `15` minutes remaining, so `onTimeRisk` is `1/8 = 0.125` (12.5% of legs are tight). It does **not** mean a 12.5% chance of being late, only that one transition leaves almost no buffer.

### Thought experiments

- **Lower threshold, fewer risky legs:** Consider an itinerary with slack values `[40, 20, 5]` minutes and a threshold of `15`. Only the final leg has slack below `15`, so `onTimeRisk` is `1/3 ≈ 0.33`.
- **Higher threshold, more conservative plan:** Using the same slack values but raising the threshold to `30`, both the second and third legs fall short, yielding `onTimeRisk = 2/3 ≈ 0.67`. The higher threshold forces you to treat more of the day as tight.

Tactically, a high `onTimeRisk` means delays on multiple legs could push you past the day's end. Lower it by dropping distant stores, adding slack (e.g., a later end time), or increasing drive time estimates with `--robustness` or lower `--mph`.
