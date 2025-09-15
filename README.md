# rustbelt

Utility for planning store visits.

## Getting Started

Refer to the [Getting Started guide](docs/getting-started.md) for a full walkthrough, including validation tips powered by the [trip schema](docs/trip-schema.json), and skim the [Trip Schema Guide](docs/trip-schema-guide.md) for a quick reference to the required fields.

1. **Install dependencies**
   ```sh
   npm install
   ```
2. **Build the CLI**
   ```sh
   npm run build
   ```
   This compiles TypeScript sources to `dist/`.
3. **Create a trip file**
   Save the following minimal example as `fixtures/getting-started-trip.json`:
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
4. **Run a solve**
   ```sh
   npx tsx src/index.ts solve-day --trip fixtures/getting-started-trip.json --day day-1
   ```
   After building you can also run:
   ```sh
   node dist/index.js solve-day --trip fixtures/getting-started-trip.json --day day-1
   ```

## Documentation

- [CLI usage](docs/rust-belt-cli-documentation.md)
- [Trip schema guide](docs/trip-schema-guide.md)
- [Trip schema](docs/trip-schema.json)
- [Test plan](docs/rust-belt-test-plan.md)
- [Route planner overview](docs/route-planner-overview.md)
- [Route planner implementation notes](docs/route-planner-implementation.md)

## Output Options

The CLI prints itinerary JSON to stdout by default. Additional formats can
be generated with flags:

- `--out <file>` – write the JSON itinerary to a file.
- `--csv <file>` – export store stops as CSV.
- `--kml [file]` – emit a KML representation to a file or stdout.
- `--html [file]` – emit an HTML itinerary to a file or stdout. Templates can be customized via `emitHtml`.

Output paths may include `${runId}` and `${timestamp}` tokens. These expand to
the trip's `runId` (if provided) and the solver run timestamp formatted as
`YYYYMMDD[T]HHmm` (UTC). For example:

```
rustbelt solve-day --trip trips/example.json --day 2025-10-01 \
  --out "out/itinerary-${runId}-${timestamp}.json"
```

The KML output includes an `<ExtendedData>` block for each stop. Placemarks
expose fields such as `id`, `type`, `arrive`, `depart`, `score`, `driveMin`,
`distanceMi`, `dwellMin`, and `tags`:

```xml
<Placemark>
  <name>Example Store</name>
  <ExtendedData>
    <Data name="id"><value>123</value></Data>
    <Data name="arrive"><value>2025-10-01T10:00:00Z</value></Data>
    <Data name="driveMin"><value>12</value></Data>
  </ExtendedData>
  <Point><coordinates>-81.7,41.5,0</coordinates></Point>
</Placemark>
```

Applications like Google Earth surface these properties in a placemark's
**Properties/Get Info** window, and they can be accessed programmatically by
parsing the `<ExtendedData>` entries.

## HTML Templates

HTML itineraries are rendered with [Mustache](https://mustache.github.io/) templates.
The default template is `src/io/templates/itinerary.mustache` which includes
a `stop` partial for each stop row.

You can customize the HTML output by providing your own template or partials
to `emitHtml`:

```ts
import { readFileSync } from 'fs';
import { emitHtml } from './src/io/emitHtml';
const template = readFileSync('myTemplate.mustache', 'utf8');
const runTs = new Date().toISOString();
const html = emitHtml(days, runTs, { template });
```

Copy and modify the default templates as a starting point.
