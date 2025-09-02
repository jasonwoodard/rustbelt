# rustbelt

Utility for planning store visits.

## Output Options

The CLI prints itinerary JSON to stdout by default. Additional formats can
be generated with flags:

- `--out <file>` – write the JSON itinerary to a file.
- `--csv <file>` – export store stops as CSV.
- `--kml [file]` – emit a KML representation to a file or stdout.
- `--html [file]` – emit an HTML itinerary to a file or stdout. Templates can be customized via `emitHtml`.

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
const html = emitHtml(days, { template });
```

Copy and modify the default templates as a starting point.
