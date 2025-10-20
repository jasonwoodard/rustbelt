# Getting Started

This guide walks through setting up the Rust Belt CLI, authoring an input trip, and running your first solve.

## 1. Install dependencies

Use npm to install the workspace dependencies:

```sh
npm install
```

## 2. Build the CLI

Compile the TypeScript sources before running the CLI directly:

```sh
npm run build
```

The build output is emitted to `dist/`, which can be executed with Node or packaged for distribution.

## 3. Create a minimal trip file

Every trip includes three root properties: `config`, `days`, and `stores`. The snippet below highlights the required fields and is saved as `fixtures/getting-started-trip.json` for convenience:

```json
{
  "config": {
    "mph": 30,
    "defaultDwellMin": 15
  },
  "days": [
    {
      "dayId": "day-1",
      "start": { "id": "hotel", "lat": 41.5, "lon": -81.7 },
      "end": { "id": "hotel", "lat": 41.5, "lon": -81.7 },
      "window": { "start": "8:00", "end": "17:00" }
    }
  ],
  "stores": [
    {
      "id": "store-1",
      "name": "Coffee Stop",
      "lat": 41.6,
      "lon": -81.69,
      "dwellMin": 15
    }
  ]
}
```

Refer to the [trip schema](trip-schema.json) for a full description of every supported field and validation constraints.

## 4. Validate the trip

Use your preferred JSON Schema validator with [`docs/trip-schema.json`](trip-schema.json) to catch missing or malformed fields. For example, `ajv` can be run with `npx ajv validate -s docs/trip-schema.json -d fixtures/getting-started-trip.json`.

## 5. Run a solve

Execute the CLI with the `solve-day` command, passing the day identifier from your trip file:

```sh
   # from packages/solver-cli
   npx tsx src/index.ts solve-day --trip fixtures/getting-started-trip.json --day day-1
```

After building, you can also invoke the compiled bundle:

```sh
node dist/index.js solve-day --trip fixtures/getting-started-trip.json --day day-1
```

This produces an itinerary JSON payload on stdout that you can redirect to a file or pipe into another tool.
