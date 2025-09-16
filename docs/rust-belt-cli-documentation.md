# Rust Belt CLI

This document describes how to use the `rustbelt` command-line interface. The solver honors per‑store open hours so that closed locations are never scheduled.

## Quick Start

1. Review the minimal trip JSON in the [Getting Started guide](getting-started.md); the sample is saved at `fixtures/getting-started-trip.json`.
2. Solve the demo day with:

   ```sh
   rustbelt solve-day --trip fixtures/getting-started-trip.json --day day-1
   ```

   The itinerary JSON prints to stdout; pass `--out <file>` if you also want to save it to disk.

## Setup

Install dependencies and run the CLI either directly from the TypeScript
sources or from the compiled JavaScript.

```sh
npm install
npx tsx src/index.ts --help    # run from source
# or
npm run build
node dist/index.js --help      # run after build
```

## Usage

```
rustbelt solve-day --trip <file> --day <id> [options]
```

`solve-day` is the default command, so it can be omitted. The tool reads a trip JSON file and produces an itinerary for the specified day. The trip file must contain a `days` array with `dayId` values; `--day` selects which entry to solve. The flag is required—omitting it or providing a non‑existent `dayId` causes the CLI to exit with an error. When `--now` and `--at` are provided, the solver reoptimizes the remaining day from the given time and location.

## Options

| Flag                     | Description                                   |
| ------------------------ | --------------------------------------------- |
| `--trip <file>`          | Path to trip JSON file                        |
| `--day <id>`             | Day id to solve (required)                    |
| `--mph <mph>`            | Average speed in mph                          |
| `--default-dwell <min>`  | Default dwell minutes                         |
| `--seed <seed>`          | Random seed                                   |
| `--lambda <lambda>`      | Score weighting (0=count,1=score)             |
| `--verbose`              | Print heuristic steps                         |
| `--progress`             | Print heuristic progress                      |
| `--now <HH:mm>`          | Reoptimize from this time (leading zero optional) |
| `--at <lat,lon>`         | Current location                              |
| `--done <ids>`           | Comma-separated list of completed store IDs   |
| `--out <file>`           | Write itinerary JSON to this path (overwrite) |
| `--kml [file]`           | Write KML to this path (or stdout)            |
| `--csv <file>`           | Write store stops CSV to this path (includes tags column) |
| `--html [file]`          | Write HTML itinerary to this path or stdout   |
| `--robustness <factor>`  | Multiply travel times by this factor          |
| `--risk-threshold <min>` | Slack threshold minutes for on-time risk      |

## Flag behavior

### Speed and dwell overrides

- `--mph <mph>` – Overrides the average speed used to estimate drive times. If omitted, the solver falls back to the day value, then the trip-level `config.mph`, and finally 30 mph. Higher values shorten drive estimates; lower values lengthen them.
- `--default-dwell <min>` – Overrides the default number of minutes spent at each stop. Without this flag the day default, trip default, or 0 minutes is used in that order.

### Randomness and objective

- `--seed <seed>` – Sets the pseudo‑random seed. Supplying the same seed reproduces results; different seeds may explore different itineraries.
- `--lambda <lambda>` – Blends the objective between stop count and total score. `0` maximizes the number of stops, `1` maximizes score, and intermediate values weight the two.

### Solver output and logging

- `--verbose` – Emits detailed heuristic decisions.
- `--progress` – Prints progress metrics after each heuristic phase. When combined with `--verbose` the order of stops for each phase is also shown.

### Reoptimization flags

- `--now <HH:mm>` (leading zero optional) and `--at <lat,lon>` – When both flags are supplied, the solver reoptimizes the remainder of the day starting from the given time and location. Any IDs passed with `--done <ids>` are excluded from further consideration. If only one of `--now` or `--at` is provided, the solver starts from the day's original start and ignores the reoptimization parameters.

### Output format flags

- `--out <file>` – Writes the itinerary JSON to the specified path in addition to printing it to stdout, overwriting the file if it exists.
- `--kml [file]` – Generates a KML representation with stop data in `<ExtendedData>`. With a path argument, the KML is written to that file; otherwise, it is printed to stdout.
- `--csv <file>` – Exports a CSV of store stops with arrival and departure times.
- `--html [file]` – Emits an HTML itinerary to the given file or to stdout. Templates can be customized via `emitHtml`.

Output paths support `${runId}` and `${timestamp}` tokens. These expand to the
trip's `runId` (if any) and the solver run timestamp in `YYYYMMDD[T]HHmm` UTC
format.

Each KML placemark contains an `<ExtendedData>` block listing fields such as
`id`, `type`, `arrive`, `depart`, `score`, `driveMin`, `distanceMi`,
`dwellMin`, and `tags`:

```xml
<Placemark>
  <name>Example Store</name>
  <ExtendedData>
    <Data name="id"><value>123</value></Data>
    <Data name="depart"><value>2025-10-01T10:15:00Z</value></Data>
    <Data name="tags"><value>priority;promo</value></Data>
  </ExtendedData>
</Placemark>
```

Consumers like Google Earth expose these values in the placemark's
**Properties/Get Info** dialog and they can be read programmatically by parsing
the `<ExtendedData>` entries.

## Trip file notes

- Coordinates: For anchors and stores you can provide either numeric `lat`/`lon` or a `location` string. The `location` accepts `lat,lon`, a Plus Code, or a Google Maps URL containing `@lat,lon`.
- Tags: Store `tags` may be an array of strings or a single string. When a string is provided, comma/semicolon/pipe separators are supported.
  Tags are preserved in JSON, CSV, HTML, and KML outputs. The CSV export includes a `tags` column containing semicolon-separated values.
- Day availability: If a store has a `dayId` field, it is only considered on that day.
- Store hours: Each day must specify a `dayOfWeek` (e.g., "Monday"). Stores may include an `openHours` object mapping weekday codes to arrays of `[open, close]` windows. The solver only visits a store when the arrival and dwell fit within one of that day's windows. Missing entries mean the store is closed, and providing an empty array for a weekday also marks the store as closed on that day, while omitting `openHours` makes the store always available.
- Dedupe: When `config.snapDuplicateToleranceMeters` is set, stores within that distance are treated as duplicates and deduped on load.

### Travel time adjustments and risk

- `--robustness <factor>` – Scales all computed drive times by the given factor. Values greater than `1` make the schedule more conservative; values below `1` make it more aggressive. This flag overrides day and trip configuration defaults.
- `--risk-threshold <min>` – Sets the slack threshold used to compute the fraction of legs at risk of finishing late. A higher value marks more legs as risky. The flag overrides any value in the trip file; the default is `0` minutes, which reports no risk.

## Output

The solver prints the resulting itinerary as JSON, including a `runTimestamp` field for tracking when the plan was generated. If `--out` is specified, the JSON is also written to the provided path. Supplying `--kml` emits a KML representation to the given file or to stdout when no file is provided. Using `--csv` saves a CSV of all store stops. Passing `--html` writes an HTML itinerary to the given file or stdout; templates can be customized via `emitHtml`.

After emitting the JSON, the CLI prints a one-line summary that includes any binding or violated limits (e.g., `binding=maxStops | violations=none`). See the [constraint diagnostics](rust-belt-output-guide.md#constraint-diagnostics) section of the output guide for definitions and examples of these diagnostics.

## Examples

Solve a day and save the itinerary and store stops:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 --out plans/day1.json --csv plans/day1.csv
```

Reoptimize from 1:30 PM at a specific location:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 --now 13:30 --at 41.5,-81.7
```

### Reserve a midday break

The solver can schedule downtime inside a target window. Passing
`--break-window 12:00-13:00` inserts a special stop with the `BREAK_ID`
(`__break__`) during that hour:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 --break-window 12:00-13:00
```

The resulting itinerary JSON includes a `type: "break"` entry that
highlights when the pause occurs:

```json
{
  "id": "__break__",
  "name": "Break",
  "type": "break",
  "arrive": "12:15",
  "depart": "12:45",
  "dwellMin": 30
}
```

## See also

- [Trip schema](trip-schema.json) – structure of trip JSON files
- [Test plan](rust-belt-test-plan.md) – walkthrough of typical commands
