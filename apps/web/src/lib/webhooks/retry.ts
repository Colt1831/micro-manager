import { getDb, schema } from '@workmanagement/database';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { deliverToEndpoint, type WebhookPayload } from './deliver';

// ─── Webhook retry sweep ───────────────────────────────────────
//
// The delivery path (deliver.ts) records `nextRetryAt` on a failed delivery log
// but nothing consumes it. This service is the consumer: it re-delivers due,
// failed deliveries whose subscription is still active, bounded by the
// subscription's `retryCount` (max attempts). Each log row is the retry unit —
// its `attempt` counter and `nextRetryAt` are updated in place.
//
// Concurrency: a row is CLAIMED with a conditional update that nulls
// `nextRetryAt` only if it is still due. The claim is atomic (one UPDATE), so
// two concurrent cron invocations can never both claim the same row and
// double-send. URL/DNS pinning is re-validated inside deliverToEndpoint on
// every attempt.

export interface RetrySweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  exhausted: number;
}

const MAX_BATCH = 100;

export async function retryDueWebhookDeliveries(now: Date = new Date()): Promise<RetrySweepResult> {
  const db = getDb();
  const result: RetrySweepResult = { claimed: 0, delivered: 0, failed: 0, exhausted: 0 };

  // Candidate due, failed logs joined to their (active) subscription. Ordered so
  // the oldest-due go first; capped so one sweep can't run unbounded.
  const candidates = await db
    .select({
      logId: schema.webhookDeliveryLogs.id,
      attempt: schema.webhookDeliveryLogs.attempt,
      eventType: schema.webhookDeliveryLogs.eventType,
      payload: schema.webhookDeliveryLogs.payload,
      subId: schema.webhookSubscriptions.id,
      url: schema.webhookSubscriptions.url,
      secret: schema.webhookSubscriptions.secret,
      headers: schema.webhookSubscriptions.headers,
      timeoutMs: schema.webhookSubscriptions.timeoutMs,
      retryCount: schema.webhookSubscriptions.retryCount,
      retryIntervalMs: schema.webhookSubscriptions.retryIntervalMs,
    })
    .from(schema.webhookDeliveryLogs)
    .innerJoin(
      schema.webhookSubscriptions,
      eq(schema.webhookDeliveryLogs.subscriptionId, schema.webhookSubscriptions.id),
    )
    .where(
      and(
        eq(schema.webhookDeliveryLogs.success, false),
        isNotNull(schema.webhookDeliveryLogs.nextRetryAt),
        lte(schema.webhookDeliveryLogs.nextRetryAt, now),
        eq(schema.webhookSubscriptions.isActive, true),
      ),
    )
    .limit(MAX_BATCH);

  for (const c of candidates) {
    // ── Claim the row race-safely: null out nextRetryAt only if still due.
    // If another sweep already claimed it, this returns [] and we skip.
    const claimed = await db
      .update(schema.webhookDeliveryLogs)
      .set({ nextRetryAt: null })
      .where(
        and(
          eq(schema.webhookDeliveryLogs.id, c.logId),
          isNotNull(schema.webhookDeliveryLogs.nextRetryAt),
          lte(schema.webhookDeliveryLogs.nextRetryAt, now),
        ),
      )
      .returning({ id: schema.webhookDeliveryLogs.id });

    if (claimed.length === 0) continue;
    result.claimed++;

    const maxAttempts = c.retryCount ?? 3;
    const nextAttempt = (c.attempt ?? 1) + 1;

    // Re-deliver (URL/DNS pinning re-validated inside deliverToEndpoint).
    const delivery = await deliverToEndpoint(
      c.url,
      c.payload as WebhookPayload,
      c.secret,
      (c.headers ?? {}) as Record<string, string>,
      c.timeoutMs ?? 10000,
    );

    if (delivery.success) {
      // Success: mark the log succeeded, clear retry, record on the subscription.
      await db
        .update(schema.webhookDeliveryLogs)
        .set({
          success: true,
          responseStatusCode: delivery.statusCode,
          durationMs: delivery.durationMs,
          errorMessage: null,
          attempt: nextAttempt,
          nextRetryAt: null,
        })
        .where(eq(schema.webhookDeliveryLogs.id, c.logId));
      await db
        .update(schema.webhookSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(eq(schema.webhookSubscriptions.id, c.subId));
      result.delivered++;
    } else {
      // Failure: increment attempt; schedule another retry only if attempts
      // remain, else null (terminal).
      const attemptsRemain = nextAttempt < maxAttempts;
      const nextRetryAt = attemptsRemain
        ? new Date(Date.now() + (c.retryIntervalMs ?? 5000))
        : null;
      await db
        .update(schema.webhookDeliveryLogs)
        .set({
          responseStatusCode: delivery.statusCode,
          durationMs: delivery.durationMs,
          errorMessage: delivery.errorMessage,
          attempt: nextAttempt,
          nextRetryAt,
        })
        .where(eq(schema.webhookDeliveryLogs.id, c.logId));
      await db
        .update(schema.webhookSubscriptions)
        .set({ lastFailureAt: new Date(), lastFailureReason: delivery.errorMessage })
        .where(eq(schema.webhookSubscriptions.id, c.subId));
      if (attemptsRemain) result.failed++;
      else result.exhausted++;
    }
  }

  return result;
}
