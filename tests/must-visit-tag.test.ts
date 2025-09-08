import { describe, it, expect } from 'vitest';
import { solveDay } from '../src/app/solveDay';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('must-visit tags', () => {
  it('includes stores tagged must-visit in the plan', () => {
    const tripPath = join(__dirname, '../fixtures/tagged-must-visit.json');
    const result = solveDay({ tripPath, dayId: 'D1' });
    const data = JSON.parse(result.json);
    const ids = data.days[0].stops.map((s: { id: string }) => s.id);
    expect(ids).toEqual(['S', 'D', 'B', 'C', 'E']);
    expect(data.days[0].metrics.storesVisited).toBe(3);
  });
});
