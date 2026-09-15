import { describe, it, expect } from 'vitest';
import { TimeEntryCreateSchema } from '@/lib/api/validation';

/**
 * Phase 4 — the manual-entry schema now accepts explicit startTime/endTime
 * (replacing the old `body.startTime` bypass), and rejects end-before-start.
 */
describe('TimeEntryCreateSchema — manual start/end', () => {
  it('accepts a manual entry with explicit ISO start/end and coerces to Date', () => {
    const parsed = TimeEntryCreateSchema.safeParse({
      entryType: 'manual',
      startTime: '2026-03-01T09:00:00.000Z',
      endTime: '2026-03-01T10:30:00.000Z',
      description: 'Worked on X',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.startTime).toBeInstanceOf(Date);
      expect(parsed.data.endTime).toBeInstanceOf(Date);
    }
  });

  it('rejects endTime before startTime', () => {
    const parsed = TimeEntryCreateSchema.safeParse({
      entryType: 'manual',
      startTime: '2026-03-01T10:00:00.000Z',
      endTime: '2026-03-01T09:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('allows a timer entry with no start/end (server now() is authoritative)', () => {
    const parsed = TimeEntryCreateSchema.safeParse({ entryType: 'timer' });
    expect(parsed.success).toBe(true);
  });
});
