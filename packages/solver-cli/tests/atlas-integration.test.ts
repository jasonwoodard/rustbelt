import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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
  const traceValidator = compileValidator('trace');

  it('validate Atlas score, anchor, and cluster schemas', () => {
    const scoreRows = parseCsv(readFileSync(join(atlasFixtureDir, 'dense-urban-scores.csv'), 'utf8'));
    expect(scoreRows.length).toBeGreaterThan(0);
    const scoreStoreIds = new Set(scoreRows.map((row) => row.StoreId));
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
    const anchorById = new Map(anchorRows.map((row) => [row.anchor_id, row] as const));
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

    const anchorAssignments = parseCsv(
      readFileSync(join(atlasFixtureDir, 'dense-urban-anchor-assignments.csv'), 'utf8'),
    );
    expect(anchorAssignments.length).toBe(scoreRows.length);
    const assignmentsByAnchor = new Map<string, string[]>();
    const assignmentStoreIds = new Set<string>();
    for (const row of anchorAssignments) {
      const anchorId = row.anchor_id;
      expect(anchorById.has(anchorId)).toBe(true);
      assignmentStoreIds.add(row.StoreId);
      const bucket = assignmentsByAnchor.get(anchorId);
      if (bucket) {
        bucket.push(row.StoreId);
      } else {
        assignmentsByAnchor.set(anchorId, [row.StoreId]);
      }
    }
    expect(assignmentStoreIds).toEqual(scoreStoreIds);
    let totalAssigned = 0;
    for (const [anchorId, assignmentRows] of assignmentsByAnchor) {
      const anchor = anchorById.get(anchorId);
      expect(anchor).toBeDefined();
      const storeCount = Number(anchor?.store_count ?? 0);
      expect(assignmentRows.length).toBe(storeCount);
      for (const storeId of assignmentRows) {
        expect(scoreStoreIds.has(storeId)).toBe(true);
      }
      totalAssigned += assignmentRows.length;
    }
    expect(totalAssigned).toBe(anchorAssignments.length);

    const anchorMetrics = JSON.parse(
      readFileSync(join(atlasFixtureDir, 'dense-urban-anchor-metrics.json'), 'utf8'),
    ) as {
      algorithm: string;
      num_anchors: number;
      total_points: number;
      noise_points?: number;
    };
    expect(anchorMetrics.algorithm).toBe('dbscan');
    expect(anchorMetrics.num_anchors).toBe(anchorRows.length);
    const noisePoints = anchorMetrics.noise_points ?? 0;
    expect(anchorMetrics.total_points).toBe(anchorAssignments.length + noisePoints);

    const clusterLines = readFileSync(join(atlasFixtureDir, 'dense-urban-subclusters.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    expect(clusterLines.length).toBeGreaterThan(0);
    for (const line of clusterLines) {
      const payload = JSON.parse(line) as unknown;
      assertValid(clusterValidator, payload, 'Cluster record');
    }

    const traceLines = readFileSync(join(atlasFixtureDir, 'dense-urban-trace.jsonl'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(traceLines.length).toBeGreaterThan(0);
    const seenStages = new Set<string>();
    for (const line of traceLines) {
      const payload = JSON.parse(line) as Record<string, unknown>;
      assertValid(traceValidator, payload, `Trace record ${(payload['store_id'] as string) || 'unknown'}`);
      if (typeof payload.stage === 'string') {
        seenStages.add(payload.stage);
      }
    }
    expect(seenStages.has('prior')).toBe(true);
    expect(seenStages.has('blend')).toBe(true);

    const posteriorTraceRows = parseCsv(readFileSync(join(atlasFixtureDir, 'dense-urban-posterior-trace.csv'), 'utf8'));
    expect(posteriorTraceRows.length).toBeGreaterThan(0);
    for (const row of posteriorTraceRows) {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        const trimmed = value.trim();
        if (trimmed === '') {
          payload[key] = null;
          continue;
        }
        const numeric = Number(trimmed);
        payload[key] = Number.isFinite(numeric) ? numeric : trimmed;
      }
      assertValid(traceValidator, payload, `Posterior trace record ${(payload['store_id'] as string) || 'unknown'}`);
      expect(payload.stage).toBe('posterior');
    }

    const subclusterSpecPath = join(atlasFixtureDir, 'dense-urban-subcluster-spec.json');
    const subclusterSpec = JSON.parse(readFileSync(subclusterSpecPath, 'utf8')) as Array<{
      key: string;
      parent_key?: string;
      store_ids: string[];
    }>;
    expect(Array.isArray(subclusterSpec)).toBe(true);
    const rootSpec = subclusterSpec.find((node) => node.key === 'root');
    expect(rootSpec).toBeDefined();
    const anchorOneStores = assignmentsByAnchor.get('metro-anchor-001') ?? [];
    expect(new Set(rootSpec?.store_ids ?? [])).toEqual(new Set(anchorOneStores));
    const childSpecs = subclusterSpec.filter((node) => node.parent_key === 'root');
    expect(childSpecs.length).toBeGreaterThan(0);
    for (const node of childSpecs) {
      expect(node.store_ids.length).toBeGreaterThan(0);
      for (const storeId of node.store_ids) {
        expect(anchorOneStores.includes(storeId)).toBe(true);
      }
    }

    const diagnosticsPath = join(atlasFixtureDir, 'atlas-diagnostics-v0.2.json');
    const diagnostics = JSON.parse(readFileSync(diagnosticsPath, 'utf8')) as {
      metadata?: {
        diagnostics_version?: string;
        record_count?: number;
        lambda_weight?: number;
        anchor_assignments?: { records?: number; unique_anchors?: number };
        subclusters?: { records?: number };
      };
      distributions?: Record<string, { count?: number }>;
      correlations?: { method?: string };
      qa_signals?: { warnings?: unknown[]; high_leverage_anchors?: unknown[] };
    };
    expect(diagnostics.metadata?.diagnostics_version).toBe('v0.2');
    expect(diagnostics.metadata?.record_count).toBe(scoreRows.length);
    expect(diagnostics.metadata?.anchor_assignments?.records).toBe(anchorAssignments.length);
    expect(diagnostics.metadata?.anchor_assignments?.unique_anchors).toBe(anchorRows.length);
    if (diagnostics.metadata?.subclusters) {
      expect(diagnostics.metadata.subclusters.records).toBeGreaterThan(0);
    }
    expect(diagnostics.correlations?.method).toBe('pearson');
    expect(diagnostics.distributions?.Composite?.count).toBe(scoreRows.length);
    expect(Array.isArray(diagnostics.qa_signals?.warnings)).toBe(true);
    expect(Array.isArray(diagnostics.qa_signals?.high_leverage_anchors)).toBe(true);

    const diagnosticsHtmlPath = join(atlasFixtureDir, 'atlas-diagnostics-v0.2.html');
    const diagnosticsParquetPath = join(atlasFixtureDir, 'atlas-diagnostics-v0.2.parquet');
    expect(statSync(diagnosticsHtmlPath).size).toBeGreaterThan(0);
    expect(statSync(diagnosticsParquetPath).size).toBeGreaterThan(0);
  });

  it('executes solver CLI against Atlas fixtures', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'solver-cli-atlas-'));
    try {
      const tripPath = join(atlasFixtureDir, 'dense-urban-trip.json');
      const itineraryPath = join(workDir, 'itinerary.json');
      const csvPath = join(workDir, 'stops.csv');
      const htmlPath = join(workDir, 'itinerary.html');
      const kmlPath = join(workDir, 'itinerary.kml');

      const cliPath = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
      const cliArgs = [
        join(repoRoot, 'packages', 'solver-cli', 'src', 'index.ts'),
        'solve-day',
        '--trip',
        tripPath,
        '--day',
        'D1',
        '--lambda',
        '1',
        '--out',
        itineraryPath,
        '--csv',
        csvPath,
        '--html',
        htmlPath,
        '--kml',
        kmlPath,
      ];

      execFileSync(cliPath, cliArgs, {
        cwd: join(repoRoot, 'packages', 'solver-cli'),
        stdio: 'pipe',
      });

      const itinerary = JSON.parse(readFileSync(itineraryPath, 'utf8')) as {
        days: Array<{ metrics: { storesVisited: number; totalScore: number } }>;
      };
      expect(itinerary.days[0].metrics.storesVisited).toBeGreaterThan(0);
      expect(itinerary.days[0].metrics.totalScore).toBeGreaterThan(0);

      const csvContent = readFileSync(csvPath, 'utf8').trim();
      expect(csvContent.split(/\r?\n/).length).toBeGreaterThan(1);

      const htmlContent = readFileSync(htmlPath, 'utf8');
      expect(htmlContent.includes('<html')).toBe(true);

      const kmlContent = readFileSync(kmlPath, 'utf8');
      expect(kmlContent.includes('<kml')).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
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
