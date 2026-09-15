import { getDb, schema } from '@workmanagement/database';
import { eq, and, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'crypto';
import { isPublicWebhookUrl } from './url-guard';
import { safeWebhookDispatcher } from './pinned-lookup';

// ─── Event Types ───────────────────────────────────────────────

export const WEBHOOK_EVENTS = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED: 'task.assigned',
  TASK_COMMENT_ADDED: 'task.comment_added',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
} as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

// ─── Payload Type ──────────────────────────────────────────────

export interface WebhookPayload {
  event: WebhookEvent;
  organizationId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Sign Payload ──────────────────────────────────────────────

/**
 * Create an HMAC-SHA256 signature for a webhook payload.
 */
export function signPayload(payload: WebhookPayload, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify an HMAC-SHA256 signature. Uses timing-safe comparison.
 */
export function verifySignature(
  payload: WebhookPayload,
  secret: string,
  signature: string,
): boolean {
  try {
    const expected = signPayload(payload, secret);
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signature);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ─── Deliver Webhook ───────────────────────────────────────────

interface DeliverWebhookResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  errorMessage: string | null;
}

export async function deliverToEndpoint(
  url: string,
  payload: WebhookPayload,
  secret: string,
  customHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<DeliverWebhookResult> {
  const startTime = Date.now();

  // Re-check at delivery time (defense in depth: a subscription may predate the
  // guard or have been crafted to bypass create-time validation).
  const guard = isPublicWebhookUrl(url);
  if (!guard.ok) {
    return { success: false, statusCode: null, durationMs: 0, errorMessage: `Blocked: ${guard.reason}` };
  }

  const signature = signPayload(payload, secret);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': payload.timestamp,
      'X-Webhook-Event': payload.event,
      'User-Agent': 'WorkManager-Webhook/1.0',
      ...customHeaders,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error', // never follow redirects (could point at an internal target)
      // Pin the connection to a validated public IP — defeats DNS-rebinding
      // (a public host that resolves to a private/internal address).
      dispatcher: safeWebhookDispatcher,
    } as RequestInit & { dispatcher: unknown });

    clearTimeout(timer);
    const durationMs = Date.now() - startTime;

    return {
      success: response.ok,
      statusCode: response.status,
      durationMs,
      errorMessage: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      statusCode: null,
      durationMs,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Dispatch Event ────────────────────────────────────────────

/**
 * Find all active webhook subscriptions matching the event type and
 * deliver the payload to each. This runs asynchronously (fire-and-forget).
 *
 * @param event - The event type
 * @param organizationId - Organization scope
 * @param data - Event-specific data payload
 */
export async function dispatchWebhookEvent(
  event: WebhookEvent,
  organizationId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb();

    // Find all active subscriptions for this org that match the event
    const subscriptions = await db
      .select()
      .from(schema.webhookSubscriptions)
      .where(
        and(
          eq(schema.webhookSubscriptions.organizationId, organizationId),
          eq(schema.webhookSubscriptions.isActive, true),
          sql`${event} = ANY(${schema.webhookSubscriptions.events})`,
        ),
      );

    if (subscriptions.length === 0) return;

    const payload: WebhookPayload = {
      event,
      organizationId,
      timestamp: new Date().toISOString(),
      data,
    };

    // Deliver to all matching endpoints (sequentially to avoid flooding)
    for (const sub of subscriptions) {
      const result = await deliverToEndpoint(
        sub.url,
        payload,
        sub.secret,
        (sub.headers ?? {}) as Record<string, string>,
        sub.timeoutMs ?? 10000,
      );

      // Record the delivery attempt (immutable log)
      const customHeaders = (sub.headers ?? {}) as Record<string, string>;
      await db.insert(schema.webhookDeliveryLogs).values({
        subscriptionId: sub.id,
        eventType: event,
        payload,
        requestHeaders: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': '***', // Don't log the actual signature
          'X-Webhook-Event': event,
          ...customHeaders,
        },
        responseStatusCode: result.statusCode,
        durationMs: result.durationMs,
        success: result.success,
        errorMessage: result.errorMessage,
        nextRetryAt: result.success ? null : new Date(Date.now() + (sub.retryIntervalMs ?? 5000)),
      });

      // Update subscription status
      if (result.success) {
        await db
          .update(schema.webhookSubscriptions)
          .set({ lastSuccessAt: new Date() })
          .where(eq(schema.webhookSubscriptions.id, sub.id));
      } else {
        await db
          .update(schema.webhookSubscriptions)
          .set({
            lastFailureAt: new Date(),
            lastFailureReason: result.errorMessage,
          })
          .where(eq(schema.webhookSubscriptions.id, sub.id));
      }
    }
  } catch (error) {
    // Webhook dispatch failures should never crash the app
    console.error(
      '[webhooks] Failed to dispatch event:',
      error instanceof Error ? error.message : error,
    );
  }
}
