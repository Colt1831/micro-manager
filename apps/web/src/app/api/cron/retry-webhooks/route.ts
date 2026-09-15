import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/db';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { retryDueWebhookDeliveries } from '@/lib/webhooks/retry';

export const runtime = 'nodejs';

/**
 * POST /api/cron/retry-webhooks
 *
 * Sweeps due, failed webhook deliveries (nextRetryAt <= now) whose subscription
 * is still active and re-delivers them, bounded by the subscription's
 * retryCount. Race-safe: concurrent invocations can't double-send.
 *
 * Security: requires CRON_SECRET (isCronAuthorized — fails closed).
 */
export const POST = async (request: NextRequest) => {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing CRON_SECRET' } },
        { status: 401 },
      );
    }

    const result = await retryDueWebhookDeliveries();

    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), result });
  } catch (error) {
    const { error: err, status } = handleApiError(error, 'Failed to retry webhooks');
    return NextResponse.json(err, { status });
  }
};

// Also support GET for simpler cron setups.
export const GET = async (request: NextRequest) => POST(request);
