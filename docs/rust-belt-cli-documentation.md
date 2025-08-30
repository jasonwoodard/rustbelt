# Rust Belt CLI

This document describes how to use the `rustbelt` command-line interface.

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
| `--now <HH:mm>`          | Reoptimize from this time                     |
| `--at <lat,lon>`         | Current location                              |
| `--done <ids>`           | Comma-separated list of completed store IDs   |
| `--out <file>`           | Write itinerary JSON to this path (overwrite) |
| `--kml [file]`           | Write KML to this path (or stdout)            |
| `--csv <file>`           | Write store stops CSV to this path            |
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

- `--now <HH:mm>` and `--at <lat,lon>` – When both flags are supplied, the solver reoptimizes the remainder of the day starting from the given time and location. Any IDs passed with `--done <ids>` are excluded from further consideration. If only one of `--now` or `--at` is provided, the solver starts from the day's original start and ignores the reoptimization parameters.

### Output format flags

- `--out <file>` – Writes the itinerary JSON to the specified path in addition to printing it to stdout, overwriting the file if it exists.
- `--kml [file]` – Generates a KML representation. With a path argument, the KML is written to that file; otherwise, it is printed to stdout.
- `--csv <file>` – Exports a CSV of store stops with arrival and departure times.
- `--html [file]` – Emits an HTML itinerary to the given file or to stdout. Templates can be customized via `emitHtml`.

## Trip file notes

- Coordinates: For anchors and stores you can provide either numeric `lat`/`lon` or a `location` string. The `location` accepts `lat,lon`, a Plus Code, or a Google Maps URL containing `@lat,lon`.
- Tags: Store `tags` may be an array of strings or a single string. When a string is provided, comma/semicolon/pipe separators are supported.
- Day availability: If a store has a `dayId` field, it is only considered on that day.
- Dedupe: When `config.snapDuplicateToleranceMeters` is set, stores within that distance are treated as duplicates and deduped on load.

### Travel time adjustments and risk

- `--robustness <factor>` – Scales all computed drive times by the given factor. Values greater than `1` make the schedule more conservative; values below `1` make it more aggressive. This flag overrides day and trip configuration defaults.
- `--risk-threshold <min>` – Sets the slack threshold used to compute the fraction of legs at risk of finishing late. A higher value marks more legs as risky. The flag overrides any value in the trip file; the default is `0` minutes, which reports no risk.

## Output

The solver prints the resulting itinerary as JSON. If `--out` is specified, the JSON is also written to the provided path. Supplying `--kml` emits a KML representation to the given file or to stdout when no file is provided. Using `--csv` saves a CSV of all store stops. Passing `--html` writes an HTML itinerary to the given file or stdout; templates can be customized via `emitHtml`.

## Examples

Solve a day and save the itinerary and store stops:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 --out plans/day1.json --csv plans/day1.csv
```

Reoptimize from 1:30 PM at a specific location:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 --now 13:30 --at 41.5,-81.7
```
