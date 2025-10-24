import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import { solveDay } from '../src/app/solveDay';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '../../..');
const atlasFixtureDir = join(repoRoot, 'fixtures', 'solver', 'atlas');
const schemaDir = join(repoRoot, 'schema', 'atlas', 'v1');

function parseCsv(content: string): Record<string, string>[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    return record;
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseStoreIds(raw: string): string[] {
  const matches = [...raw.matchAll(/'([^']+)'/g)];
  if (matches.length > 0) {
    return matches.map((match) => match[1]);
  }
  const cleaned = raw.replace(/[()\[\]"]/g, '').trim();
  return cleaned ? cleaned.split(/\s*,\s*/).filter(Boolean) : [];
}

function compileValidator(name: string): ValidateFunction<unknown> {
  const schemaPath = join(schemaDir, `${name}.schema.json`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

function assertValid(validator: ValidateFunction<unknown>, payload: unknown, label: string): void {
  const valid = validator(payload);
  if (!valid) {
    const details = (validator.errors ?? [])
      .map((error) => `${error.instancePath || '(root)'} ${error.message ?? ''}`.trim())
      .join('; ');
    throw new Error(`${label} failed schema validation: ${details || 'unknown error'}`);
  }
}

describe('Atlas integration fixtures', () => {
  const scoreValidator = compileValidator('score');
  const anchorValidator = compileValidator('anchor');
  const clusterValidator = compileValidator('cluster');

  it('validate Atlas score, anchor, and cluster schemas', () => {
    const scoreRows = parseCsv(readFileSync(join(atlasFixtureDir, 'dense-urban-scores.csv'), 'utf8'));
    expect(scoreRows.length).toBeGreaterThan(0);
    for (const row of scoreRows) {
      const payload = {
        StoreId: row.StoreId,
        ValuePrior: toNumber(row.ValuePrior),
        YieldPrior: toNumber(row.YieldPrior),
        CompositePrior: toNumber(row.CompositePrior),
        Theta: toNumber(row.Theta),
        YieldPosterior: toNumber(row.YieldPosterior),
        ValuePosterior: toNumber(row.ValuePosterior),
        Cred: toNumber(row.Cred),
        Method: row.Method || null,
        ECDF_q: toNumber(row.ECDF_q),
        Omega: toNumber(row.Omega),
        Value: toNumber(row.Value),
        Yield: toNumber(row.Yield),
        Composite: toNumber(row.Composite),
      };
      assertValid(scoreValidator, payload, `Score record ${row.StoreId}`);
    }

    const anchorRows = parseCsv(readFileSync(join(atlasFixtureDir, 'dense-urban-anchors.csv'), 'utf8'));
    expect(anchorRows.length).toBeGreaterThan(0);
    for (const row of anchorRows) {
      const payload = {
        anchor_id: row.anchor_id,
        cluster_label: Number(row.cluster_label),
        centroid_lat: Number(row.centroid_lat),
        centroid_lon: Number(row.centroid_lon),
        store_count: Number(row.store_count),
        store_ids: parseStoreIds(row.store_ids),
      };
      assertValid(anchorValidator, payload, `Anchor record ${row.anchor_id}`);
      expect(payload.store_ids.length).toBe(payload.store_count);
    }

    const clusterLines = readFileSync(join(atlasFixtureDir, 'dense-urban-subclusters.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    expect(clusterLines.length).toBeGreaterThan(0);
    for (const line of clusterLines) {
      const payload = JSON.parse(line) as unknown;
      assertValid(clusterValidator, payload, 'Cluster record');
    }
  });

  it('runs solver end-to-end with Atlas-scored trip', () => {
    const tripPath = join(atlasFixtureDir, 'dense-urban-trip.json');
    const result = solveDay({ tripPath, dayId: 'D1', lambda: 1 });
    const itinerary = JSON.parse(result.json) as { days: Array<{ metrics: { storesVisited: number; totalScore: number } }>; };
    expect(result.metrics.storesVisited).toBe(5);
    expect(result.metrics.totalScore).toBeGreaterThan(0);
    expect(itinerary.days[0].metrics.storesVisited).toBe(result.metrics.storesVisited);
  });
});
