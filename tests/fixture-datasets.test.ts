import { describe, it, expect } from 'vitest';
import { solveDay } from '../src/app/solveDay';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('fixture datasets', () => {
  it('clustered candidates yield many visits', () => {
    const tripPath = join(__dirname, '../fixtures/clustered-candidates.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json);
    expect(data.days[0].metrics.storesVisited).toBe(5);
  });

  it('scattered candidates yield no visits', () => {
    const tripPath = join(__dirname, '../fixtures/scattered-candidates.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json);
    expect(data.days[0].metrics.storesVisited).toBe(0);
  });

  it('far must-visit allows only the required stop', () => {
    const tripPath = join(__dirname, '../fixtures/far-must-visit.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json);
    expect(data.days[0].metrics.storesVisited).toBe(1);
  });
});
