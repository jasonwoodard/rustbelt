
/**
 * follow_redirects_node.js
 *
 * Trace the HTTP redirect chain for a URL and print each hop.
 * Works well on Windows (Node.js). No shell tools needed.
 *
 * Usage:
 *   npm i got
 *   node follow_redirects_node.js "https://www.google.com/maps?cid=8877565883447878750" --max 15 --out redirects.txt
 *
 * What it prints:
 *   - Each hop: [n] <status> <currentURL>  and the Location it points to (if any)
 *   - The final URL
 *   - If the final URL contains an @lat,lon tuple (or q=lat,lon, ll=lat,lon, daddr=lat,lon), it prints coords
 */
import fs from "fs";
import got from "got";

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node follow_redirects_node.js "<URL>" [--max 15] [--out redirects.txt]');
  process.exit(1);
}

let url = null;
let maxHops = 15;
let outFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--max" && args[i+1]) {
    maxHops = parseInt(args[++i], 10);
  } else if (a === "--out" && args[i+1]) {
    outFile = args[++i];
  } else if (!url) {
    url = a;
  } else {
    console.error("Unexpected argument:", a);
    process.exit(1);
  }
}

if (!url) {
  console.error("Missing URL.");
  process.exit(1);
}

function write(line) {
  if (outFile) fs.appendFileSync(outFile, line + "\n");
  console.log(line);
}

// Extract coords helper
function extractCoords(u) {
  // @lat,lon
  let m = u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lon: +m[2], via: "@tuple" };
  // q=lat,lon
  m = u.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lon: +m[2], via: "q" };
  // ll=lat,lon
  m = u.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lon: +m[2], via: "ll" };
  // daddr=lat,lon
  m = u.match(/[?&]daddr=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lon: +m[2], via: "daddr" };
  return null;
}

async function headOrGet(u) {
  // Try HEAD first; some servers reject HEAD -> then GET
  try {
    const resp = await got(u, { method: "HEAD", followRedirect: false, throwHttpErrors: false, timeout: { request: 15000 } });
    return resp;
  } catch (e) {
    // fallback to GET headers only; still do not follow redirects
    const resp = await got(u, { method: "GET", followRedirect: false, throwHttpErrors: false, timeout: { request: 20000 } });
    return resp;
  }
}

(async () => {
  if (outFile && fs.existsSync(outFile)) fs.unlinkSync(outFile);
  write(`start: ${url}`);

  let current = url;
  for (let i = 1; i <= maxHops; i++) {
    const resp = await headOrGet(current);
    const status = resp.statusCode;
    // Node 'got' normalizes headers to lowercase
    const location = resp.headers["location"];
    write(`[${i}] ${status} ${current}`);
    if (location) {
      // Resolve relative locations
      try {
        const resolved = new URL(location, current).toString();
        write(`     → ${resolved}`);
        current = resolved;
        continue;
      } catch {
        write(`     → ${location}`);
        current = location;
        continue;
      }
    } else {
      break; // no redirect target; assume final
    }
  }

  write(`final: ${current}`);
  const coords = extractCoords(current);
  if (coords) {
    write(`coords: ${coords.lat},${coords.lon} (via ${coords.via})`);
  }
})().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
