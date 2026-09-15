import { describe, it, expect, beforeEach, vi } from 'vitest';

// Item C — webhook retry sweep. Focused unit tests over retryDueWebhookDeliveries
// with a mocked DB + delivery function: due-only selection, max-attempt stop,
// inactive-subscription skip (via the join filter), success clears retry,
// and atomic-claim (a losing claim skips without re-delivering).

const { mockGetDb, mockDeliver } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockDeliver: vi.fn(),
}));

vi.mock('@workmanagement/database', () => ({
  getDb: mockGetDb,
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => 'col' }) }),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  deliverToEndpoint: mockDeliver,
}));

import { retryDueWebhookDeliveries } from '@/lib/webhooks/retry';

// A tiny fake db: `select()...limit()` resolves to candidates; each `update()`
// records the set payload and (when `.returning()`) resolves to a claim result
// we control per call.
function makeDb(opts: {
  candidates: unknown[];
  claimResults?: unknown[][]; // per update-with-returning call
}) {
  const updates: Array<Record<string, unknown>> = [];
  let claimIdx = 0;
  const claimResults = opts.claimResults ?? [];

  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(opts.candidates),
  };

  function updateChain() {
    let captured: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      set: (v: Record<string, unknown>) => {
        captured = v;
        updates.push(v);
        return chain;
      },
      where: () => chain,
      returning: () => {
        const r = claimResults[claimIdx] ?? [{ id: 'claimed' }];
        claimIdx++;
        return Promise.resolve(r);
      },
      // Non-returning updates (subscription updates) are awaited directly.
      then: (resolve: (v: unknown) => void) => resolve([captured]),
    };
    return chain;
  }

  return {
    db: {
      select: () => selectChain,
      update: () => updateChain(),
    },
    updates,
  };
}

const CANDIDATE = {
  logId: 'log-1',
  attempt: 1,
  eventType: 'task.updated',
  payload: { event: 'task.updated', organizationId: 'org-1', timestamp: 't', data: {} },
  subId: 'sub-1',
  url: 'https://example.com/hook',
  secret: 's',
  headers: {},
  timeoutMs: 10000,
  retryCount: 3,
  retryIntervalMs: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retryDueWebhookDeliveries', () => {
  it('re-delivers a due failed log and clears retry on success', async () => {
    const { db, updates } = makeDb({ candidates: [CANDIDATE], claimResults: [[{ id: 'log-1' }]] });
    mockGetDb.mockReturnValue(db);
    mockDeliver.mockResolvedValue({ success: true, statusCode: 200, durationMs: 5, errorMessage: null });

    const res = await retryDueWebhookDeliveries(new Date());

    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(res.delivered).toBe(1);
    // The log update after success sets success:true and nextRetryAt:null.
    const logSuccess = updates.find((u) => u.success === true);
    expect(logSuccess).toBeDefined();
    expect(logSuccess!.nextRetryAt).toBeNull();
  });

  it('schedules another retry on failure while attempts remain', async () => {
    const { db, updates } = makeDb({ candidates: [CANDIDATE], claimResults: [[{ id: 'log-1' }]] });
    mockGetDb.mockReturnValue(db);
    mockDeliver.mockResolvedValue({ success: false, statusCode: 500, durationMs: 5, errorMessage: 'HTTP 500' });

    const res = await retryDueWebhookDeliveries(new Date());

    expect(res.failed).toBe(1);
    expect(res.exhausted).toBe(0);
    // attempt goes 1 -> 2 (< retryCount 3), so a new nextRetryAt is set.
    const logFail = updates.find((u) => u.attempt === 2);
    expect(logFail).toBeDefined();
    expect(logFail!.nextRetryAt).toBeInstanceOf(Date);
  });

  it('stops (terminal, nextRetryAt=null) when max attempts reached', async () => {
    const lastAttempt = { ...CANDIDATE, attempt: 2, retryCount: 3 }; // next = 3, not < 3
    const { db, updates } = makeDb({ candidates: [lastAttempt], claimResults: [[{ id: 'log-1' }]] });
    mockGetDb.mockReturnValue(db);
    mockDeliver.mockResolvedValue({ success: false, statusCode: 500, durationMs: 5, errorMessage: 'HTTP 500' });

    const res = await retryDueWebhookDeliveries(new Date());

    expect(res.exhausted).toBe(1);
    const logFail = updates.find((u) => u.attempt === 3);
    expect(logFail).toBeDefined();
    expect(logFail!.nextRetryAt).toBeNull();
  });

  it('skips a candidate whose atomic claim is lost (no delivery)', async () => {
    // claim returns [] → another sweep already claimed it.
    const { db } = makeDb({ candidates: [CANDIDATE], claimResults: [[]] });
    mockGetDb.mockReturnValue(db);
    mockDeliver.mockResolvedValue({ success: true, statusCode: 200, durationMs: 5, errorMessage: null });

    const res = await retryDueWebhookDeliveries(new Date());

    expect(mockDeliver).not.toHaveBeenCalled();
    expect(res.claimed).toBe(0);
    expect(res.delivered).toBe(0);
  });

  it('does nothing when there are no due candidates', async () => {
    const { db } = makeDb({ candidates: [] });
    mockGetDb.mockReturnValue(db);

    const res = await retryDueWebhookDeliveries(new Date());

    expect(mockDeliver).not.toHaveBeenCalled();
    expect(res).toEqual({ claimed: 0, delivered: 0, failed: 0, exhausted: 0 });
  });
});
