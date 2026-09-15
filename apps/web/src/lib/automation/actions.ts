import type { AutomationContext } from './engine';
import { createElement } from 'react';
import { db, schema } from '@/lib/api/db';
import { eq, and, isNull } from 'drizzle-orm';
import { mutateTask, SYSTEM_SCOPE } from '@/lib/tasks/mutate';

// ─── Action Definitions ────────────────────────────────────

export interface NotifyActionConfig {
  userIds: string[];
  message: string;
  type?: string;
}

export interface ChangeStatusActionConfig {
  status: string;
}

export interface AssignActionConfig {
  userId: string;
}

export interface AddLabelActionConfig {
  label: string;
}

export interface ChangePriorityActionConfig {
  priority: string;
}

export interface EscalateActionConfig {
  message: string;
  userIds?: string[];
}

export interface SendEmailActionConfig {
  /** Email addresses to send to directly */
  to?: string[];
  /** User IDs to look up and send to */
  userIds?: string[];
  /** Email subject line */
  subject: string;
  /** Email body message */
  message: string;
}

export type ActionConfig =
  | { type: 'notify'; config: NotifyActionConfig }
  | { type: 'change_status'; config: ChangeStatusActionConfig }
  | { type: 'assign'; config: AssignActionConfig }
  | { type: 'add_label'; config: AddLabelActionConfig }
  | { type: 'change_priority'; config: ChangePriorityActionConfig }
  | { type: 'escalate'; config: EscalateActionConfig }
  | { type: 'send_email'; config: SendEmailActionConfig };

// ─── Execute Action ────────────────────────────────────────

/**
 * Execute a single automation action within the given context.
 *
 * @throws If the action fails for any reason.
 */
export async function executeAction(
  action: { type: string; config: Record<string, unknown> },
  context: AutomationContext,
): Promise<void> {
  switch (action.type) {
    case 'notify':
      await executeNotify(action.config as unknown as NotifyActionConfig, context);
      break;
    case 'change_status':
      await executeChangeStatus(action.config as unknown as ChangeStatusActionConfig, context);
      break;
    case 'assign':
      await executeAssign(action.config as unknown as AssignActionConfig, context);
      break;
    case 'add_label':
      await executeAddLabel(action.config as unknown as AddLabelActionConfig, context);
      break;
    case 'change_priority':
      await executeChangePriority(action.config as unknown as ChangePriorityActionConfig, context);
      break;
    case 'escalate':
      await executeEscalate(action.config as unknown as EscalateActionConfig, context);
      break;
    case 'send_email':
      await executeSendEmail(action.config as unknown as SendEmailActionConfig, context);
      break;
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

// ─── Action Implementations ────────────────────────────────

async function executeSendEmail(
  config: SendEmailActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { to, userIds, subject, message } = config;
  if (!subject) throw new Error('Email subject is required');
  if (!message) throw new Error('Email message is required');

  const recipients: string[] = [];

  // Collect direct email addresses
  if (to && to.length > 0) {
    recipients.push(...to);
  }

  // Look up emails from user IDs — org-scoped (active, not deleted) so a rule
  // can't email across tenants.
  if (userIds && userIds.length > 0) {
    const { inArray } = await import('drizzle-orm');

    const users = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.id, userIds),
          eq(schema.users.organizationId, context.organizationId),
          eq(schema.users.isActive, true),
          isNull(schema.users.deletedAt),
        ),
      );

    for (const user of users) {
      if (user.email) recipients.push(user.email);
    }
  }

  if (recipients.length === 0) {
    throw new Error('No recipients specified for email');
  }

  // Dedupe recipients (direct `to` addresses aren't DB-scoped but must dedupe).
  const uniqueRecipients = Array.from(new Set(recipients));

  // Build email link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const entityLink = `${appUrl}/${context.entityType}s/${context.entityId}`;

  // Render and send via the email system
  const { render } = await import('@react-email/components');
  const { AutomationTriggeredEmail } = await import('@/lib/email/components');
  const { sendEmail } = await import('@/lib/email');

  const unsubscribeUrl = process.env.EMAIL_UNSUBSCRIBE_URL ?? `${appUrl}/settings/notifications`;
  const html = await render(
    createElement(AutomationTriggeredEmail, {
      title: subject,
      message,
      link: entityLink,
      unsubscribeUrl,
    }),
  );

  // Send to each recipient individually (BCC would be better but some ESPs
  // require individual sends for deliverability)
  for (const recipient of uniqueRecipients) {
    try {
      await sendEmail({ to: recipient, subject, html });
    } catch {
      console.warn(`[automation] Failed to send email to ${recipient.slice(0, 3)}***`);
    }
  }
}

async function executeNotify(
  config: NotifyActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { userIds, message } = config;
  if (!userIds || userIds.length === 0) {
    throw new Error('No user IDs specified for notification');
  }

  // Org-scope the recipients so a rule can't notify across tenants.
  const orgUserIds = await filterOrgUserIds(context.organizationId, userIds);

  // Attempt to notify each user via the notification system
  const { createNotification } = await import('@/lib/notifications');

  for (const userId of orgUserIds) {
    try {
      await createNotification({
        organizationId: context.organizationId,
        userId,
        type: 'automation.triggered',
        title: 'Automation Triggered',
        message: message || `A rule was triggered for ${context.entityType}`,
        link: `/${context.entityType}s/${context.entityId}`,
        entityType: context.entityType,
        entityId: context.entityId,
      });
    } catch {
      // Individual notification failures shouldn't stop others
      console.warn(`[automation] Failed to notify user ${userId}`);
    }
  }
}

async function executeChangeStatus(
  config: ChangeStatusActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { status } = config;
  if (!status) throw new Error('No status specified');
  await applyTaskMutation(context, { status });
}

/**
 * Load the target task (org-scoped, not deleted) and apply a mutation through
 * the shared task-mutation service so history/audit/search/webhook/notification
 * side effects fire. `suppressAutomation` prevents automation → automation loops.
 */
async function applyTaskMutation(
  context: AutomationContext,
  changes: Parameters<typeof mutateTask>[0]['changes'],
): Promise<void> {
  if (context.entityType !== 'task') {
    throw new Error(`task mutation not supported for entity type: ${context.entityType}`);
  }

  const [existing] = await db()
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.id, context.entityId),
        eq(schema.tasks.organizationId, context.organizationId),
        isNull(schema.tasks.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) throw new Error('Task not found');

  const result = await mutateTask({
    existing,
    changes,
    actorUserId: context.triggeredByUserId ?? existing.createdBy,
    actorScope: SYSTEM_SCOPE,
    orgId: context.organizationId,
    suppressAutomation: true,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }
}

async function executeAssign(
  config: AssignActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { userId } = config;
  if (!userId) throw new Error('No user ID specified for assignment');
  await applyTaskMutation(context, { assignedTo: userId });
}

async function executeAddLabel(
  config: AddLabelActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { label } = config;
  if (!label) throw new Error('No label specified');
  if (context.entityType !== 'task') {
    throw new Error(`add_label action not supported for entity type: ${context.entityType}`);
  }

  // Read current labels (org-scoped) to append idempotently.
  const [task] = await db()
    .select({ labels: schema.tasks.labels })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.id, context.entityId),
        eq(schema.tasks.organizationId, context.organizationId),
        isNull(schema.tasks.deletedAt),
      ),
    )
    .limit(1);

  if (!task) throw new Error('Task not found');
  const currentLabels: string[] = (task.labels as string[]) ?? [];
  if (currentLabels.includes(label)) return; // Already has the label

  await applyTaskMutation(context, { labels: [...currentLabels, label] });
}

async function executeChangePriority(
  config: ChangePriorityActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { priority } = config;
  if (!priority) throw new Error('No priority specified');
  await applyTaskMutation(context, { priority });
}

async function executeEscalate(
  config: EscalateActionConfig,
  context: AutomationContext,
): Promise<void> {
  const { message, userIds } = config;

  if (context.entityType !== 'task') {
    throw new Error(`escalate action not supported for entity type: ${context.entityType}`);
  }

  // First, bump priority to critical through the shared service.
  await applyTaskMutation(context, { priority: 'critical' });

  // Notify the escalation recipients — org-scoped so cross-org IDs are ignored.
  if (userIds && userIds.length > 0) {
    const orgUserIds = await filterOrgUserIds(context.organizationId, userIds);
    const { createNotification } = await import('@/lib/notifications');
    for (const userId of orgUserIds) {
      try {
        await createNotification({
          organizationId: context.organizationId,
          userId,
          type: 'task.escalated',
          title: '⚠️ Task Escalated',
          message: message || 'Task has been escalated',
          link: `/${context.entityType}s/${context.entityId}`,
          entityType: context.entityType,
          entityId: context.entityId,
        });
      } catch {
        console.warn(`[automation] Failed to escalate to user ${userId}`);
      }
    }
  }
}

/**
 * Filter a list of user IDs to only those in the given org (active, not deleted).
 * Automation recipient lookups must be org-scoped so a rule can't notify or
 * assign across tenants.
 */
async function filterOrgUserIds(organizationId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { inArray } = await import('drizzle-orm');
  const rows = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        inArray(schema.users.id, userIds),
        eq(schema.users.organizationId, organizationId),
        eq(schema.users.isActive, true),
        isNull(schema.users.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}
