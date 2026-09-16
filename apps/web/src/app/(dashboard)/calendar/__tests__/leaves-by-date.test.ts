import { describe, it, expect } from 'vitest';
import { leavesByDateFrom, type Leave } from '../calendar-client';

const mk = (over: Partial<Leave>): Leave => ({
  id: 'l1',
  userId: 'u1',
  startDate: '2026-01-05',
  endDate: '2026-01-05',
  isHalfDay: false,
  user: { id: 'u1', name: 'Ada' },
  leaveType: { name: 'PTO', color: '#0ea5e9' },
  ...over,
});

describe('leavesByDateFrom', () => {
  it('expands a multi-day leave onto every covered day', () => {
    const map = leavesByDateFrom([mk({ startDate: '2026-01-05', endDate: '2026-01-07' })]);
    expect(map.get(new Date('2026-01-05T00:00:00').toDateString())).toHaveLength(1);
    expect(map.get(new Date('2026-01-06T00:00:00').toDateString())).toHaveLength(1);
    expect(map.get(new Date('2026-01-07T00:00:00').toDateString())).toHaveLength(1);
    expect(map.get(new Date('2026-01-08T00:00:00').toDateString())).toBeUndefined();
  });

  it('maps a single-day leave to exactly one day', () => {
    const map = leavesByDateFrom([mk({})]);
    expect([...map.keys()]).toHaveLength(1);
    expect(map.get(new Date('2026-01-05T00:00:00').toDateString())).toHaveLength(1);
  });

  it('stacks multiple leaves on the same day', () => {
    const map = leavesByDateFrom([mk({ id: 'a' }), mk({ id: 'b' })]);
    expect(map.get(new Date('2026-01-05T00:00:00').toDateString())).toHaveLength(2);
  });

  it('skips an invalid range (end before start)', () => {
    const map = leavesByDateFrom([mk({ startDate: '2026-01-07', endDate: '2026-01-05' })]);
    expect(map.size).toBe(0);
  });
});
