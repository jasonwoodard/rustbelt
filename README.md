# rustbelt

Utility for planning store visits.

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
