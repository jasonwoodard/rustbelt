import { describe, it, expect } from 'vitest';
import { program } from '../src/index';

describe('CLI', () => {
  it('configures the commander program', () => {
    expect(program.name()).toBe('rustbelt');
    expect(program.description()).toBe('CLI for ...');
    expect(program.version()).toBe('0.1.0');
    expect(program.commands.map((c) => c.name())).toContain('solve-day');
  });
});
