
/**
 * expand_maps_links.js
 * Batch-expands Google Maps short links (maps.app.goo.gl / goo.gl/maps / place_id links)
 * and extracts coordinates from the final URL. Falls back to Plus Code decoding.
 *
 * Usage:
 *   npm i got p-limit csv-parse csv-stringify open-location-code
 *   node expand_maps_links.js input.csv output.csv URL_COLUMN_NAME --ref "42.3314,-83.0458"
 *
 * Notes:
 * - We only follow redirects and parse the final URL (no scraping the page HTML).
 * - For short Plus Codes, we can optionally "recoverNearest" using --ref (lat,lon).
 * - Be kind to the network: we throttle via p-limit.
 */

import fs from "fs";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import got from "got";
import pLimit from "p-limit";
import * as olc from "open-location-code";

const [,, inPath, outPath, urlColRaw, ...rest] = process.argv;
if (!inPath || !outPath || !urlColRaw) {
  console.error("Usage: node expand_maps_links.js input.csv output.csv URL_COLUMN_NAME --ref \"lat,lon\"");
  process.exit(1);
}

let refCoord = null;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--ref" && rest[i+1]) {
    const [lat, lon] = rest[i+1].split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) refCoord = { lat, lon };
  }
}

const urlCol = urlColRaw.trim();
const raw = fs.readFileSync(inPath, "utf8");
const rows = parseCsv(raw, { columns: true, skip_empty_lines: true });

const limit = pLimit(5); // throttle concurrency
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractFromUrl(u) {
  try {
    const url = new URL(u);
    const s = u;

    // 1) @lat,lon,zoom
    let m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|%2C)/);
    if (m) return { lat: +m[1], lon: +m[2], source: "@tuple" };

    // 2) q=lat,lon
    m = s.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: +m[1], lon: +m[2], source: "q" };

    // 3) ll=lat,lon
    m = s.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: +m[1], lon: +m[2], source: "ll" };

    // 4) daddr=lat,lon
    m = s.match(/[?&]daddr=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: +m[1], lon: +m[2], source: "daddr" };

    // 5) Plus Code in the path/query
    // Find candidate full plus code: e.g., "86JHGR6C+2Q"
    m = s.match(/\b[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}\b/);
    if (m) {
      const code = decodeURIComponent(m[0]);
      try {
        const d = olc.decode(code);
        return { lat: d.latitudeCenter, lon: d.longitudeCenter, source: "pluscode_full" };
      } catch {}
    }

    // Short plus code like "GR6C+2Q Royal Oak, MI"
    // Try to detect a pattern "XXXX+XX" plus following locality words
    m = s.match(/\b[23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2}\b/);
    if (m && refCoord) {
      try {
        const recovered = olc.recoverNearest(m[0], refCoord.lat, refCoord.lon);
        const d = olc.decode(recovered);
        return { lat: d.latitudeCenter, lon: d.longitudeCenter, source: "pluscode_recovered" };
      } catch {}
    }
  } catch {}
  return null;
}

async function expandOne(u) {
  if (!u || typeof u !== "string") return null;
  // If it already has direct coords, parse without network
  const direct = extractFromUrl(u);
  if (direct) return { finalUrl: u, ...direct };

  // Otherwise, try to follow redirects to obtain a final URL
  try {
    // HEAD first
    let resp;
    try {
      resp = await got.head(u, { followRedirect: true, throwHttpErrors: false, timeout: { request: 10000 } });
    } catch {
      // fallback to GET with minimal download
      resp = await got(u, { followRedirect: true, throwHttpErrors: false, timeout: { request: 15000 } });
    }
    const final = resp.url || u;
    const info = extractFromUrl(final);
    if (info) return { finalUrl: final, ...info };
  } catch (err) {
    // ignore; return null below
  }
  return null;
}

(async () => {
  const tasks = rows.map((row, idx) => limit(async () => {
    const u = row[urlCol];
    const res = await expandOne(u);
    // polite pacing to avoid hammering
    await sleep(100);
    return { idx, res };
  }));

  const results = await Promise.all(tasks);
  const outRows = rows.map((row, i) => {
    const found = results.find(r => r.idx === i)?.res || null;
    return {
      ...row,
      lat: found?.lat ?? "",
      lon: found?.lon ?? "",
      coord_source: found?.source ?? ""
    };
  });

  const csv = stringifyCsv(outRows, { header: true });
  fs.writeFileSync(outPath, csv);
  const parsed = outRows.filter(r => r.lat !== "" && r.lon !== "").length;
  console.log(`Wrote ${outPath}. Parsed coords for ${parsed}/${rows.length} rows.`);
})();
