import { describe, it, expect } from 'vitest';
import { computeProgress } from '../progress';

describe('computeProgress', () => {
  it('returns 0 when a project has no tasks (never NaN)', () => {
    expect(computeProgress(0, 0)).toBe(0);
  });

  it('returns the completed percentage, rounded', () => {
    expect(computeProgress(8, 3)).toBe(38); // 37.5 -> 38
    expect(computeProgress(4, 1)).toBe(25);
  });

  it('returns 100 when every task is complete', () => {
    expect(computeProgress(5, 5)).toBe(100);
  });

  it('never exceeds 100 or drops below 0', () => {
    expect(computeProgress(2, 5)).toBe(100);
    expect(computeProgress(5, -1)).toBe(0);
  });
});
