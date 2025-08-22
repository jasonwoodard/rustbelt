import { describe, it, expect } from 'vitest';
import { run, program } from '../src/index';

describe('CLI', () => {
  it('configures the commander program', () => {
    run(['node', 'rustbelt']);
    expect(program.name()).toBe('rustbelt');
    expect(program.description()).toBe('CLI for ...');
    expect(program.version()).toBe('0.1.0');
  });
});
