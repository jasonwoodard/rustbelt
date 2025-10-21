# Trip Schema Guide

Use this guide as a narrative companion to [`docs/trip-schema.json`](trip-schema.json). It summarizes the three required root objects—`config`, `days`, and `stores`—and highlights the most common fields with short examples. Validate your JSON with the schema for full coverage once the structure looks right.

## Root shape

Each trip JSON file must provide these top-level properties:

```json
{
  "config": { ... },
  "days": [ ... ],
  "stores": [ ... ]
}
```

`config` establishes trip-wide defaults, `days` declares the working window for each itinerary, and `stores` defines every potential stop the solver can choose from.

## `config` object

Trip-level defaults cascade to every day unless a day overrides them.

| Field | Type | Description |
| --- | --- | --- |
| `mph` | number | Average drive speed used to estimate travel time when a day omits its own value (mph). |
| `defaultDwellMin` | number | Baseline minutes spent at each store when neither the day nor the store specifies a dwell time. |
| `seed` | number | Random seed for deterministic optimization runs. |
| `snapDuplicateToleranceMeters` | number | Distance threshold for deduplicating stores that load within the given meters. |
| `robustnessFactor` | number | Multiplier applied to computed drive times (e.g., `1.1` adds a 10% buffer). Overridden by day-level or CLI settings. |
| `riskThresholdMin` | number | Slack threshold (minutes) for reporting at-risk legs when CLI flags are absent. |
| `runId` | string | Identifier for the current run; appears in exports. |
| `runNote` | string | Free-form note stored alongside the run metadata. |

<details>
<summary>Example `config`</summary>

```json
{
  "mph": 55,
  "defaultDwellMin": 20,
  "snapDuplicateToleranceMeters": 40,
  "robustnessFactor": 1.05,
  "runId": "ohio-swing"
}
```

</details>

## `days` array

Declare one entry per day you intend to solve. Each object sets the time window, endpoints, and optional constraints or overrides.

### Required fields

| Field | Type | Description |
| --- | --- | --- |
| `dayId` | string | Unique identifier passed to `solve-day --day`. |
| `start` | object | Anchor describing where the route begins. Provide coordinates or a geocodable `location`. |
| `end` | object | Anchor describing where the route finishes (often the same as `start`). |
| `window` | object | Operating hours for the route. Requires `start` and `end` in `HH:mm` (leading zero optional).

An **anchor** must include an `id` plus either `lat`/`lon` or `location`. Optional `name` supplies a display label.

### Optional scheduling controls

| Field | Type | Description |
| --- | --- | --- |
| `mph` | number | Average speed for the day; overrides `config.mph`. |
| `defaultDwellMin` | number | Default dwell minutes for the day; overrides `config.defaultDwellMin`. |
| `mustVisitIds` | string[] | Store IDs that must appear in the itinerary. The solver errors if it cannot satisfy them. |
| `locks` | array | Constraints that pin stores to positions. Supports objects keyed by:<br>`{"storeId","position"}` with `position` = `firstAfterStart` or `lastBeforeEnd`<br>`{"storeId","index"}` with a zero-based slot<br>`{"storeId","afterStoreId"}` to keep a store immediately after another. |
| `maxDriveTime` | number | Caps total driving minutes for the day. |
| `maxStops` | number | Caps the number of planned store visits. |
| `breakWindow` | object | Reserve downtime with `start`/`end` strings formatted like the day window. |
| `robustnessFactor` | number | Day-specific buffer multiplier on drive times. |
| `riskThresholdMin` | number | Slack threshold (minutes) specific to the day. |
| `dayOfWeek` | string | Day name (`Monday`–`Sunday`) used to evaluate `store.openHours`. |

#### Declaring a break window

Add a `breakWindow` object when the day must include protected downtime. Both
`start` and `end` accept `HH:mm` strings (leading zero optional) that mirror the
day's overall `window`. The solver inserts a pseudo-stop inside that range and
marks it with the special ID `__break__`.

```json
{
  "dayId": "day-1",
  "window": { "start": "8:30", "end": "17:30" },
  "breakWindow": { "start": "12:00", "end": "12:30" }
}
```

Until the CLI grows an override flag, update the trip JSON directly to adjust or
remove breaks.

<details>
<summary>Example day</summary>

```json
{
  "dayId": "day-1",
  "start": { "id": "hotel", "name": "Downtown Hotel", "lat": 41.5, "lon": -81.7 },
  "end": { "id": "hotel", "lat": 41.5, "lon": -81.7 },
  "window": { "start": "8:30", "end": "17:30" },
  "mustVisitIds": ["store-1"],
  "locks": [
    { "storeId": "store-2", "position": "firstAfterStart" },
    { "storeId": "store-3", "afterStoreId": "store-2" }
  ],
  "breakWindow": { "start": "12:00", "end": "12:30" },
  "robustnessFactor": 1.1
}
```

</details>

## `stores` array

List every candidate location once. The solver matches store IDs referenced by days.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique store identifier (required). |
| `name` | string | Display name; defaults to `id` when omitted. |
| `lat` / `lon` | number | Coordinates if providing positions directly. Both are required when used. |
| `location` | string | Alternative to `lat`/`lon`. Accepts `"lat,lon"`, Plus Codes, or Google Maps URLs containing `@lat,lon`. |
| `address` | string | Human-readable address for exports. |
| `dwellMin` | number | Visit duration override for this specific store. |
| `score` | number | Utility score for optimization modes that consider ranking. |
| `tags` | string \| string[] | Labels for filtering or scoring. Accepts a delimited string or an array of strings. |
| `dayId` | string | If set, restricts the store to the matching day only. |
| `openHours` | object | Maps weekday codes (`mon`–`sun`) to arrays of `[open, close]` time pairs, each formatted `HH:mm`.

> Every store must include either `lat`/`lon` or `location` alongside the `id`.

<details>
<summary>Example store</summary>

```json
{
  "id": "store-5",
  "name": "Neighborhood Market",
  "location": "41.5100,-81.6900",
  "address": "123 Main St, Cleveland, OH",
  "dwellMin": 25,
  "tags": ["grocery", "priority"],
  "openHours": {
    "mon": [["09:00", "18:00"]],
    "sat": [["10:00", "16:00"]]
  }
}
```

</details>

## Next steps

* Draft trips with the shapes above.
* Validate them against [`docs/trip-schema.json`](trip-schema.json) using your preferred JSON Schema tool.
* Review the [getting started guide](getting-started.md) for a walkthrough of solving a day once the data is ready.
