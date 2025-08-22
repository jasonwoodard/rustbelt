import { describe, it, expect } from 'vitest';
import { program } from '../src/index';

describe('program', () => {
  it('has correct name', () => {
    expect(program.name()).toBe('rustbelt');
  });
});
