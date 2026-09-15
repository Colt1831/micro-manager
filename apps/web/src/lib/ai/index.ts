import { openai } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDb, schema } from '@workmanagement/database';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';

// ─── Types ──────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  model: string;
}

// ─── Default Configuration ─────────────────────────────────

const DEFAULT_CONFIGS: Record<AIProvider, AIConfig> = {
  openai: {
    provider: 'openai',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  anthropic: {
    provider: 'anthropic',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-3-haiku-20240307',
  },
};

// ─── Provider Resolution ───────────────────────────────────

export function getAIConfig(): AIConfig {
  const provider = (process.env.AI_PROVIDER ?? 'openai') as AIProvider;
  return DEFAULT_CONFIGS[provider] ?? DEFAULT_CONFIGS.openai;
}

export function getModel(config?: AIConfig) {
  const cfg = config ?? getAIConfig();

  if (cfg.provider === 'anthropic') {
    return anthropic(cfg.model);
  }

  // Default: OpenAI
  return openai(cfg.model);
}

/**
 * Thrown when an AI feature is invoked but no API key is configured (neither in
 * the organization's AI settings nor in the environment). Routes catch this to
 * return a clean "AI not configured" response instead of failing mid-stream.
 */
export class AINotConfiguredError extends Error {
  constructor() {
    super('AI is not configured: add an AI API key in Settings → AI.');
    this.name = 'AINotConfiguredError';
  }
}

/**
 * Get a language model using the API key stored in the organization's
 * AI settings (with decryption), falling back to environment variables.
 * Throws {@link AINotConfiguredError} when no key is available anywhere.
 *
 * This should be called within an authenticated API route context
 * where `orgId` is available from `withAuth`.
 */
export async function getDbModel(
  orgId: string | null,
  config?: AIConfig,
) {
  // When config is explicitly supplied, honor it verbatim. Otherwise resolve the
  // org-saved provider + model + key TOGETHER (a saved provider/model must not be
  // ignored in favor of the env default), falling back to env per provider.
  let cfg = config ?? getAIConfig();
  let apiKey: string | null = null;

  if (!config && orgId) {
    try {
      const db = getDb();
      const [org] = await db
        .select({ settings: schema.organizations.settings })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId))
        .limit(1);

      const aiSettings = (org?.settings as Record<string, unknown> | undefined)?.ai as
        | Record<string, unknown>
        | undefined;

      if (aiSettings) {
        const savedProvider = aiSettings.provider;
        if (savedProvider === 'openai' || savedProvider === 'anthropic') {
          const savedModel =
            typeof aiSettings.model === 'string' && aiSettings.model
              ? aiSettings.model
              : DEFAULT_CONFIGS[savedProvider].model;
          cfg = { provider: savedProvider, model: savedModel };
        }
        if (aiSettings.encryptedKey) {
          apiKey = decrypt(aiSettings.encryptedKey as string);
        }
      }
    } catch {
      // Fall through to env-var fallback with the default cfg.
    }
  } else if (orgId) {
    // config was supplied explicitly — still allow the org key to back it.
    try {
      const db = getDb();
      const [org] = await db
        .select({ settings: schema.organizations.settings })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId))
        .limit(1);
      const aiSettings = (org?.settings as Record<string, unknown> | undefined)?.ai as
        | Record<string, unknown>
        | undefined;
      if (aiSettings?.encryptedKey) {
        apiKey = decrypt(aiSettings.encryptedKey as string);
      }
    } catch {
      // ignore
    }
  }

  // Fall back to the provider's environment variable.
  if (!apiKey) {
    apiKey =
      (cfg.provider === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY) ?? null;
  }

  // No key anywhere → fail fast with a typed error the routes can handle
  // cleanly, BEFORE any streaming response has started.
  if (!apiKey) {
    throw new AINotConfiguredError();
  }

  if (cfg.provider === 'anthropic') {
    return createAnthropic({ apiKey })(cfg.model);
  }
  return createOpenAI({ apiKey })(cfg.model);
}

// ─── Prompt Templates ──────────────────────────────────────

export const PROMPTS = {
  taskSummary: (taskTitle: string, taskDescription: string) =>
    `Summarize the following task in 1-2 sentences, highlighting the key objective and any deadlines:

Title: ${taskTitle}
Description: ${taskDescription || 'No description provided'}

Summary:`,
  prioritySuggestion: (task: { title: string; description?: string; dueDate?: string; labels?: string[]; estimatedHours?: string }) =>
    `Based on the following task details, suggest a priority level (low, medium, high, urgent, critical) and explain why in one sentence. Consider due dates, workload indicators, and keywords.

Title: ${task.title}
Description: ${task.description || 'N/A'}
Due Date: ${task.dueDate || 'Not set'}
Labels: ${(task.labels ?? []).join(', ') || 'None'}
Estimated Hours: ${task.estimatedHours || 'Not set'}

Respond in JSON format:
{ "priority": "high", "reason": "..." }`,
  deadlineRisk: (task: { title: string; dueDate?: string; status: string; estimatedHours?: string; description?: string }) =>
    `Assess the risk of this task missing its deadline. Consider status, time remaining, and description for complexity clues.

Title: ${task.title}
Due Date: ${task.dueDate || 'Not set'}
Status: ${task.status}
Estimated Hours: ${task.estimatedHours || 'Not set'}
Description: ${(task.description || '').slice(0, 500)}

Respond in JSON format:
{ "riskLevel": "low"|"medium"|"high"|"critical", "riskScore": 0-100, "reason": "..." }`,
  duplicateDetection: (taskTitle: string, existingTitles: string[]) =>
    `Compare this new task title against the list of existing task titles. Find any that could be duplicates (same or very similar meaning). Return matches with similarity scores.

New Task: "${taskTitle}"

Existing Tasks:
${existingTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Respond in JSON format:
{ "potentialDuplicates": [{ "title": "...", "similarityScore": 0-100, "reason": "..." }] }`,
  eodReportSummary: (tasksSummary: string) =>
    `Generate an end-of-day report summary based on the following task data. Highlight completed items, items in progress, overdue items, and any blockers. Keep it concise (3-5 bullet points).

Task Data:
${tasksSummary}

Summary:`,
  writingAssistant: (text: string, instruction: string) =>
    `Improve the following text according to this instruction: "${instruction}"

Original Text:
${text}

Improved Text:`,
};
