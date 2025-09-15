# Rust Belt Output Guide

This page explains how to interpret the JSON produced by `rustbelt solve-day` and how configuration options influence the itinerary. When stores declare `openHours`, the solver only visits them within those windows and omits closed locations. The examples reference the sample output below.

```json
{
  "runTimestamp": "2025-09-11T03:08:45.285Z",
  "runId": "RID123",
  "runNote": "Exploratory run",
  "days": [
    { "dayId": "Clev-Buff", "stops": [...], "metrics": { ... } }
  ]
}
```

## Top-level fields

- **`runTimestamp`** – The ISO timestamp for when the solver generated the plan. It helps track when the itinerary was last refreshed.
- **`runId`** – Identifier carried through from the input `TripConfig` for correlating runs.
- **`runNote`** – Optional note supplied in the input to label or describe the run.
- **`days`** – An array of solved days. Each entry contains a `dayId`, an ordered list of `stops`, and a `metrics` summary.

## Stops

Each element in the `stops` array represents a location in the itinerary. Fields include:

- `id`, `name`, and `type` (`start`, `store`, or `end`).
- `arrive` and `depart` times in local time. When a store defines `openHours`, these times always fall within one of its windows.
- Geographic coordinates `lat` and `lon`.
- Optional `address` with the store's street address (store stops only).
- Optional `dwellMin` showing minutes planned at the stop.
- Optional `legIn` describing the leg from the previous stop: `fromId`, `toId`, `driveMin`, and `distanceMi`.
- Store-specific values such as `score` and `tags`.

### Example: Antiques & Uniques (`AU`)

```json
{
  "id": "AU",
  "name": "Antiques & Uniques",
  "type": "store",
  "address": "123 Main St",
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
The solver expects a 38‑minute drive from the start location to the store and schedules a 30‑minute dwell. The `address` field is included because the store input provided one. The `score` reflects store quality; higher values make a stop more desirable when optimizing.

### Example: Savers (`SAVERSB`)

This later stop arrives at 17:11 after a 56‑minute drive. The high `score` of 4.8 and `Thrift` tag indicate a priority thrift store. Comparing stops helps identify where long drives occur or which stores contribute most to the total score.

## Metrics

The `metrics` block summarizes the solved day:

```json
{
  "storeCount": 10,
  "storesVisited": 7,
  "visitedIds": ["A", "B", "C", "D", "E", "F", "G"],
  "totalScore": 29.7,
  "scorePerStore": 4.24,
  "scorePerMin": 0.05,
  "scorePerDriveMin": 0.09,
  "scorePerMile": 0.65,
  "totalDriveMin": 325.60,
  "totalDwellMin": 210,
  "slackMin": 4.40,
  "totalDistanceMiles": 310.5,
  "onTimeRisk": 0.125,
  "limitViolations": ["maxDriveTime"],
  "bindingConstraints": ["maxStops"]
}
```

| Metric | Summary |
| --- | --- |
| [`storeCount`](#metric-storecount) | Count of candidate stores considered for the day. |
| [`storesVisited`](#metric-storesvisited) | Number of store stops included in the itinerary. |
| [`visitedIds`](#metric-visitedids) | IDs for the stores the solver selected. |
| [`totalScore`](#metric-totalscore) | Sum of store scores accumulated across the day. |
| [`scorePerStore`](#metric-scoreperstore) | Average score earned per visited store. |
| [`scorePerMin`](#metric-scorepermin) | Total score divided by combined drive and dwell minutes. |
| [`scorePerDriveMin`](#metric-scoreperdrivemin) | Total score divided by drive minutes only. |
| [`scorePerMile`](#metric-scorepermile) | Total score divided by miles driven. |
| [`totalDriveMin`](#metric-totaldrivemin) | Minutes spent driving from stop to stop. |
| [`totalDwellMin`](#metric-totaldwellmin) | Minutes planned for time spent inside stores. |
| [`slackMin`](#metric-slackmin) | Unused buffer minutes left in the schedule. |
| [`totalDistanceMiles`](#metric-totaldistancemiles) | Miles driven between itinerary stops. |
| [`onTimeRisk`](#metric-ontimerisk) | Share of legs that fall below the slack threshold. |
| [`limitViolations`](#metric-limitviolations) | Constraints exceeded by the final itinerary. |
| [`bindingConstraints`](#metric-bindingconstraints) | Constraints that were exactly satisfied (tight). |

- <a id="metric-storecount"></a>**`storeCount`** – Total number of candidate stores considered for the day.
- <a id="metric-storesvisited"></a>**`storesVisited`** – Number of store stops completed.
- <a id="metric-visitedids"></a>**`visitedIds`** – IDs of stores included in the itinerary.
- <a id="metric-totalscore"></a>**`totalScore`** – Sum of `score` values for all store stops.
- <a id="metric-scoreperstore"></a>**`scorePerStore`** – Average score per visited store.
- <a id="metric-scorepermin"></a>**`scorePerMin`** – Score divided by total time (drive + dwell).
- <a id="metric-scoreperdrivemin"></a>**`scorePerDriveMin`** – Score divided by minutes spent driving.
- <a id="metric-scorepermile"></a>**`scorePerMile`** – Score divided by miles driven.
- <a id="metric-totaldrivemin"></a>**`totalDriveMin`** – Minutes spent driving between stops.
- <a id="metric-totaldwellmin"></a>**`totalDwellMin`** – Planned time inside stores.
- <a id="metric-slackmin"></a>**`slackMin`** – Unused minutes in the schedule. Low slack means the day is tightly packed.
- <a id="metric-totaldistancemiles"></a>**`totalDistanceMiles`** – Total miles driven between stops.
- <a id="metric-ontimerisk"></a>**`onTimeRisk`** – Fraction of legs with slack below the configured risk threshold. A higher value indicates more chance of falling behind schedule.
- <a id="metric-limitviolations"></a>**`limitViolations`** – Optional array naming constraints the solver could not satisfy. Values match the configuration knobs (e.g., `maxDriveTime`).
- <a id="metric-bindingconstraints"></a>**`bindingConstraints`** – Optional array naming constraints that were exactly tight. These highlight limits that shaped the itinerary even though they were not exceeded.

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

## Constraint diagnostics

The solver reports whether hard limits influenced or blocked the itinerary through two optional arrays inside `metrics`:

- **`limitViolations`** – Lists constraints the plan exceeded.
- **`bindingConstraints`** – Lists constraints that finished exactly at their cap.

When neither list has entries, the fields are omitted from the JSON, and the CLI summary prints `violations=none` and `binding=none`.

### Example: Hitting a stop cap

If a day enforces `maxStops: 7` and the solver visits seven stores, the limit becomes binding:

```json
{
  "metrics": {
    "storesVisited": 7,
    "bindingConstraints": ["maxStops"]
  }
}
```

Because the cap was met exactly, no violation occurs, but `bindingConstraints` reveals that adding another store would require raising `maxStops`. The CLI prints a summary line similar to:

```
Day RustBelt-1 | stores=7 | … | binding=maxStops | violations=none
```

Notice that `limitViolations` is absent from the JSON because there were no overruns, mirroring the `violations=none` text in the CLI summary.

### Example: Drive time violation

If the itinerary's total driving time passes a configured maximum, it appears under `limitViolations`:

```json
{
  "metrics": {
    "totalDriveMin": 330.5,
    "limitViolations": ["maxDriveTime"]
  }
}
```

In this scenario the solver could not produce a plan within the allowed drive time. The CLI summary shows `violations=maxDriveTime`, making it easy to spot the overage and adjust inputs (reduce the store list, extend the window, or lift the limit).

Here `bindingConstraints` is omitted because no limit finished exactly on its boundary.

Both arrays currently surface `maxStops` and `maxDriveTime`, matching the supported limits. Future constraints will appear in the same lists without requiring output changes.
