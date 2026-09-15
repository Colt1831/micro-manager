import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { eq } from 'drizzle-orm';
import { handleApiError } from '@/lib/api/db';
import { encrypt } from '@/lib/encryption';
import { getDbModel, AINotConfiguredError } from '@/lib/ai';
import { generateText } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';

// ─── Types ──────────────────────────────────────────────────

export interface AISettings {
  provider: 'openai' | 'anthropic';
  model: string;
  /** Whether an API key has been configured */
  hasKey: boolean;
  /** When the config was last updated */
  updatedAt: string | null;
}

// ─── Validation ─────────────────────────────────────────────

const AISettingsSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).max(500).optional(),
});

// ─── GET /api/settings/ai ──────────────────────────────────
// Returns current AI config (without exposing the full API key)

export const GET = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:view');

      const db = getDb();
      const [org] = await db
        .select({ settings: schema.organizations.settings })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId!))
        .limit(1);

      if (!org) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Organization not found' } },
          { status: 404 },
        );
      }

      const aiSettings = (org.settings as Record<string, unknown>)?.ai as
        | Record<string, unknown>
        | undefined;

      const settings: AISettings = {
        provider: (aiSettings?.provider as 'openai' | 'anthropic') ?? 'openai',
        model: (aiSettings?.model as string) ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        hasKey: !!(aiSettings?.encryptedKey as string) || !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY,
        updatedAt: (aiSettings?.updatedAt as string) ?? null,
      };

      return NextResponse.json({ settings });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to load AI settings');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'settings:ai:read' },
);

// ─── PUT /api/settings/ai ──────────────────────────────────
// Update AI provider configuration

export const PUT = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:manage');

      const body = await request.json();
      const parsed = AISettingsSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: parsed.error.errors.map((e) => e.message).join(', '),
            },
          },
          { status: 400 },
        );
      }

      const db = getDb();
      const [org] = await db
        .select({ settings: schema.organizations.settings })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId!))
        .limit(1);

      if (!org) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Organization not found' } },
          { status: 404 },
        );
      }

      // Merge with existing AI settings
      const currentSettings = (org.settings as Record<string, unknown>) ?? {};
      const currentAI = (currentSettings.ai as Record<string, unknown>) ?? {};

      const updatedAI: Record<string, unknown> = {
        ...currentAI,
        provider: parsed.data.provider ?? currentAI.provider ?? 'openai',
        model: parsed.data.model ?? currentAI.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        updatedAt: new Date().toISOString(),
      };

      // Encrypt API key if provided
      if (parsed.data.apiKey) {
        const encrypted = encrypt(parsed.data.apiKey);
        if (encrypted) {
          updatedAI.encryptedKey = encrypted;
        }
        // Store which provider the key is for
        if (parsed.data.provider === 'anthropic') {
          updatedAI.keyFor = 'anthropic';
        } else {
          updatedAI.keyFor = 'openai';
        }
      }

      await db
        .update(schema.organizations)
        .set({
          settings: {
            ...currentSettings,
            ai: updatedAI,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.organizations.id, orgId!));

      return NextResponse.json({
        success: true,
        settings: {
          provider: updatedAI.provider,
          model: updatedAI.model,
          hasKey: !!(updatedAI.encryptedKey as string),
          updatedAt: updatedAI.updatedAt,
        },
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to update AI settings');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'settings:ai:write' },
);

// ─── POST /api/settings/ai/test ───────────────────────────
// Test the AI connection by making ONE minimal real provider call.
// Requires settings:manage (spends credits). Rate limited.

export const POST = withAuth(
  async (_request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'settings:manage');

      // Resolve the org-saved provider/model/key together (getDbModel).
      let model;
      try {
        model = await getDbModel(orgId!);
      } catch (err) {
        if (err instanceof AINotConfiguredError) {
          return NextResponse.json(
            { success: false, message: 'No AI provider configured. Configure one in Settings > AI.' },
            { status: 200 },
          );
        }
        throw err;
      }

      // ONE minimal real call — tiny prompt, minimal tokens. Sanitize any
      // failure so we never leak the key or a raw provider error.
      try {
        const result = await generateText({
          model,
          prompt: 'Reply with the single word: ok',
          maxOutputTokens: 5,
          temperature: 0,
        });

        return NextResponse.json({
          success: true,
          message: 'AI provider responded successfully.',
          sample: (result.text ?? '').slice(0, 40),
        });
      } catch {
        // Never surface the provider's raw error (may echo the key/endpoint).
        return NextResponse.json(
          {
            success: false,
            message: 'AI provider call failed — check the API key, model, and provider settings.',
          },
          { status: 200 },
        );
      }
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to test AI connection');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 10, namespace: 'settings:ai:test' },
);
