import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { eq, and, isNull } from 'drizzle-orm';
import { testSlackWebhook, encryptWebhookUrl } from '@/lib/slack/webhook';

export const runtime = 'nodejs';

// ─── GET - Get Slack integration ─────────────────────────────

export const GET = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:view');
      const [integration] = await db()
        .select()
        .from(schema.slackIntegrations)
        .where(
          and(
            eq(schema.slackIntegrations.organizationId, orgId!),
            isNull(schema.slackIntegrations.deletedAt),
          ),
        )
        .limit(1);

      return NextResponse.json({
        integration: integration
          ? { ...integration, webhookUrl: undefined, hasWebhookUrl: true }
          : null,
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to get Slack integration');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'slack:get' },
);

// ─── POST - Create or update Slack integration ───────────────

export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:manage');
      const body = await request.json();
      const { webhookUrl } = body;

      if (!webhookUrl) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'webhookUrl is required' } },
          { status: 400 },
        );
      }

      if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid Slack webhook URL' } },
          { status: 400 },
        );
      }

      // Test the webhook
      const testResult = await testSlackWebhook(webhookUrl);
      if (!testResult.success) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: `Webhook test failed: ${testResult.error}` } },
          { status: 400 },
        );
      }

      // Check if integration exists
      const [existing] = await db()
        .select()
        .from(schema.slackIntegrations)
        .where(
          and(
            eq(schema.slackIntegrations.organizationId, orgId!),
            isNull(schema.slackIntegrations.deletedAt),
          ),
        )
        .limit(1);

      // Encrypt at rest. Fails CLOSED if ENCRYPTION_KEY is missing (never
      // stores plaintext). Opportunistically re-encrypts any legacy plaintext
      // row since we always write the encrypted form here.
      const encryptedUrl = encryptWebhookUrl(webhookUrl);

      let integration;
      if (existing) {
        // Update
        [integration] = await db()
          .update(schema.slackIntegrations)
          .set({ webhookUrl: encryptedUrl, updatedAt: new Date() })
          .where(eq(schema.slackIntegrations.id, existing.id))
          .returning();
      } else {
        // Create
        [integration] = await db()
          .insert(schema.slackIntegrations)
          .values({
            organizationId: orgId!,
            webhookUrl: encryptedUrl,
            createdBy: user.id,
          })
          .returning();
      }

      return NextResponse.json({ integration: { ...integration, webhookUrl: undefined, hasWebhookUrl: true } });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to save Slack integration');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'slack:save' },
);

// ─── DELETE - Remove Slack integration ───────────────────────

export const DELETE = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:manage');
      const [existing] = await db()
        .select()
        .from(schema.slackIntegrations)
        .where(
          and(
            eq(schema.slackIntegrations.organizationId, orgId!),
            isNull(schema.slackIntegrations.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'No Slack integration found' } },
          { status: 404 },
        );
      }

      await db()
        .update(schema.slackIntegrations)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(schema.slackIntegrations.id, existing.id));

      return NextResponse.json({ success: true });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to delete Slack integration');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'slack:delete' },
);
