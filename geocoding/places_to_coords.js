
/**
 * places_to_coords.js
 *
 * Convert a CSV of store names (and optional city/state) into lat/lon using
 * Google Places API (New): Text Search (IDs only) + Place Details (location).
 *
 * Usage:
 *   export GOOGLE_MAPS_API_KEY="your-key"
 *   npm i got p-limit csv-parse csv-stringify
 *   node places_to_coords.js input.csv output.csv --name-col "Name" --city-col "City" --state-col "State"
 *   # Or if you have a prebuilt query column (e.g., "Name, City, State"):
 *   node places_to_coords.js input.csv output.csv --query-col "Query"
 *
 * Notes:
 * - Text Search with FieldMask 'places.id' is free (IDs-only SKU).
 * - Place Details with FieldMask 'location' is billed under Essentials but has a generous free tier.
 * - We only request minimal fields to control cost.
 * - Caches both place_id and location on disk to avoid repeat billing.
 */

import fs from "fs";
import got from "got";
import pLimit from "p-limit";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify as stringifyCsv } from "csv-stringify/sync";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("Please set GOOGLE_MAPS_API_KEY env var.");
  process.exit(1);
}

const [,, inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node places_to_coords.js input.csv output.csv [--name-col "Name" --city-col "City" --state-col "State"] | [--query-col "Query"]');
  process.exit(1);
}

let nameCol = "Name";
let cityCol = null;
let stateCol = null;
let queryCol = null;

for (let i=0;i<rest.length;i++) {
  const k = rest[i], v = rest[i+1];
  if (k === "--name-col" && v) { nameCol = v; i++; }
  else if (k === "--city-col" && v) { cityCol = v; i++; }
  else if (k === "--state-col" && v) { stateCol = v; i++; }
  else if (k === "--query-col" && v) { queryCol = v; i++; }
}

const raw = fs.readFileSync(inPath, "utf8");
const rows = parseCsv(raw, { columns: true, skip_empty_lines: true });

const cachePath = outPath.replace(/\.csv$/i, ".places.cache.json");
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};

const limit = pLimit(3); // small concurrency
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildQuery(row) {
  if (queryCol) {
    const q = (row[queryCol] ?? "").toString().trim();
    return q || null;
  }
  const name = (row[nameCol] ?? "").toString().trim();
  if (!name) return null;
  const parts = [name];
  if (cityCol && row[cityCol]) parts.push(row[cityCol]);
  if (stateCol && row[stateCol]) parts.push(row[stateCol]);
  return parts.join(", ");
}

async function getPlaceId(q) {
  const key = `id:${q}`;
  if (cache[key]) return cache[key];
  const body = { textQuery: q };
  try {
    const resp = await got.post("https://places.googleapis.com/v1/places:searchText", {
      json: body,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.id"
      },
      timeout: { request: 15000 }
    }).json();
    await sleep(200); // polite pacing
    const id = resp?.places?.[0]?.id || null;
    cache[key] = id;
    return id;
  } catch (e) {
    cache[key] = null;
    return null;
  }
}

async function getLocation(placeId) {
  const key = `loc:${placeId}`;
  if (cache[key]) return cache[key];
  try {
    const resp = await got.get(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "location"
      },
      timeout: { request: 15000 }
    }).json();
    await sleep(200);
    const lat = resp?.location?.latitude;
    const lon = resp?.location?.longitude;
    const out = (lat != null && lon != null) ? { lat, lon } : null;
    cache[key] = out;
    return out;
  } catch (e) {
    cache[key] = null;
    return null;
  }
}

(async () => {
  const outRows = [];
  for (const row of rows) {
    const q = buildQuery(row);
    let placeId = null, loc = null;
    if (q) {
      placeId = await limit(() => getPlaceId(q))();
      if (placeId) loc = await limit(() => getLocation(placeId))();
    }
    outRows.push({
      ...row,
      place_id: placeId || "",
      lat: loc?.lat ?? "",
      lon: loc?.lon ?? ""
    });
  }
  fs.writeFileSync(outPath, stringifyCsv(outRows, { header: true }));
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  const gotLoc = outRows.filter(r => r.lat && r.lon).length;
  const gotId = outRows.filter(r => r.place_id).length;
  console.log(`Wrote ${outPath}. place_id for ${gotId}/${rows.length}, coords for ${gotLoc}/${rows.length}. Cache: ${cachePath}`);
})();
