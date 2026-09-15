import { db, schema } from '@/lib/api/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────

export interface SnapshotSummary {
  totalTasks: number;
  completedCount: number;
  overdueCount: number;
  activeProjects: number;
  totalUsers: number;
  completionRate: number;
}

export interface SnapshotData {
  timestamp: string;
  generatedBy: string;
  organizationId: string;
  date: string;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    createdThisPeriod: number;
    completedThisPeriod: number;
    completionRate: number;
  };
  projects: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
  };
  users: {
    total: number;
    active: number;
  };
  teams: {
    total: number;
  };
}

export interface SnapshotResult {
  snapshotData: SnapshotData;
  summary: SnapshotSummary & { aiSummary?: string | null };
}

// ─── Generate Snapshot Data ──────────────────────────────────

/**
 * Gather all EOD snapshot metrics for a given organization.
 * Extracted from the POST /api/reports/snapshots route so it can be
 * reused by both the user-facing API and the cron auto-generator.
 */
export async function generateEODSnapshotData(
  orgId: string,
  generatedBy?: string,
): Promise<SnapshotResult> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]!;
  const todayStartStr = dateStr + 'T00:00:00Z';
  const todayEndStr = new Date(Date.parse(todayStartStr) + 86400000).toISOString();

  const orgConditions = [eq(schema.tasks.organizationId, orgId), isNull(schema.tasks.deletedAt)];

  // ── Task counts by status ──────────────────────────────────
  const taskStatusCounts = await db()
    .select({
      status: schema.tasks.status,
      count: sql<number>`COUNT(*)::int`.as('count'),
    })
    .from(schema.tasks)
    .where(and(...orgConditions))
    .groupBy(schema.tasks.status);

  // ── Task counts by priority ────────────────────────────────
  const taskPriorityCounts = await db()
    .select({
      priority: schema.tasks.priority,
      count: sql<number>`COUNT(*)::int`.as('count'),
    })
    .from(schema.tasks)
    .where(and(...orgConditions))
    .groupBy(schema.tasks.priority);

  // ── Overdue tasks ──────────────────────────────────────────
  const [overdueResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.tasks)
    .where(
      and(
        ...orgConditions,
        sql`${schema.tasks.dueDate} < ${todayStartStr}::timestamp`,
        sql`${schema.tasks.status} NOT IN ('completed', 'closed', 'cancelled', 'archived')`,
      ),
    );

  // ── Tasks created today ────────────────────────────────────
  const [createdTodayResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.tasks)
    .where(
      and(
        ...orgConditions,
        sql`${schema.tasks.createdAt} >= ${todayStartStr}::timestamp`,
        sql`${schema.tasks.createdAt} < ${todayEndStr}::timestamp`,
      ),
    );

  // ── Tasks completed today ──────────────────────────────────
  const [completedTodayResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.tasks)
    .where(
      and(
        ...orgConditions,
        sql`${schema.tasks.status} = 'completed'`,
        sql`${schema.tasks.completedAt} >= ${todayStartStr}::timestamp`,
        sql`${schema.tasks.completedAt} < ${todayEndStr}::timestamp`,
      ),
    );

  // ── Total task count ───────────────────────────────────────
  const [totalTasksResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.tasks)
    .where(and(...orgConditions));

  // ── Project counts by status ───────────────────────────────
  const projectStatusCounts = await db()
    .select({
      status: schema.projects.status,
      count: sql<number>`COUNT(*)::int`.as('count'),
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, orgId), isNull(schema.projects.deletedAt)),
    )
    .groupBy(schema.projects.status);

  // ── Total projects ─────────────────────────────────────────
  const [totalProjectsResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, orgId), isNull(schema.projects.deletedAt)),
    );

  // ── User counts ────────────────────────────────────────────
  const [activeUsersResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.organizationId, orgId),
        isNull(schema.users.deletedAt),
        eq(schema.users.isActive, true),
        eq(schema.users.isSuspended, false),
      ),
    );

  const [totalUsersResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.users)
    .where(and(eq(schema.users.organizationId, orgId), isNull(schema.users.deletedAt)));

  // ── Team count ─────────────────────────────────────────────
  const [totalTeamsResult] = await db()
    .select({ count: sql<number>`COUNT(*)::int`.as('count') })
    .from(schema.teams)
    .where(and(eq(schema.teams.organizationId, orgId), isNull(schema.teams.deletedAt)));

  // ── Build snapshot data ────────────────────────────────────

  const byStatus: Record<string, number> = {};
  for (const row of taskStatusCounts) {
    byStatus[row.status ?? 'unknown'] = row.count;
  }

  const byPriority: Record<string, number> = {};
  for (const row of taskPriorityCounts) {
    byPriority[row.priority ?? 'none'] = row.count;
  }

  const byProjectStatus: Record<string, number> = {};
  for (const row of projectStatusCounts) {
    byProjectStatus[row.status ?? 'unknown'] = row.count;
  }

  const completedCount = byStatus['completed'] ?? 0;
  const totalTasks = totalTasksResult?.count ?? 0;
  const totalProjects = totalProjectsResult?.count ?? 0;

  const snapshotData: SnapshotData = {
    timestamp: now.toISOString(),
    generatedBy: generatedBy ?? 'system',
    organizationId: orgId,
    date: dateStr,
    tasks: {
      total: totalTasks,
      byStatus,
      byPriority,
      overdue: overdueResult?.count ?? 0,
      createdThisPeriod: createdTodayResult?.count ?? 0,
      completedThisPeriod: completedTodayResult?.count ?? 0,
      completionRate: totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0,
    },
    projects: {
      total: totalProjects,
      active: byProjectStatus['active'] ?? 0,
      byStatus: byProjectStatus,
    },
    users: {
      total: totalUsersResult?.count ?? 0,
      active: activeUsersResult?.count ?? 0,
    },
    teams: {
      total: totalTeamsResult?.count ?? 0,
    },
  };

  const summary: SnapshotSummary = {
    totalTasks,
    completedCount,
    overdueCount: overdueResult?.count ?? 0,
    activeProjects: byProjectStatus['active'] ?? 0,
    totalUsers: totalUsersResult?.count ?? 0,
    completionRate: totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0,
  };

  return { snapshotData, summary };
}

/**
 * Store a generated EOD snapshot in the database.
 *
 * Idempotent for `eod` snapshots: a partial unique index on
 * (organization_id, snapshot_date) WHERE snapshot_type='eod' guarantees at most
 * one EOD snapshot per org per day, so concurrent cron/manual generation can't
 * duplicate. Returns `{ snapshot, created }` — `created:false` means an EOD
 * snapshot already existed and is returned unchanged (callers skip notifications).
 * Non-eod types always insert (created:true).
 */
export async function storeEODSnapshot(params: {
  organizationId: string;
  snapshotType?: string;
  label?: string | null;
  snapshotData: SnapshotData;
  summary: SnapshotSummary & { aiSummary?: string | null };
  generatedBy: string;
}): Promise<{ snapshot: typeof schema.reportSnapshots.$inferSelect | undefined; created: boolean }> {
  const dateStr = new Date().toISOString().split('T')[0]!;
  const snapshotType = params.snapshotType ?? 'eod';

  const values = {
    organizationId: params.organizationId,
    snapshotDate: dateStr,
    snapshotType,
    label: params.label ?? null,
    snapshotData: params.snapshotData as unknown as Record<string, unknown>,
    summary: params.summary as unknown as Record<string, unknown>,
    generatedBy: params.generatedBy,
  };

  // Non-eod types are not covered by the unique index — insert directly.
  if (snapshotType !== 'eod') {
    const [snapshot] = await db().insert(schema.reportSnapshots).values(values).returning();
    return { snapshot, created: true };
  }

  // EOD: race-safe insert. onConflictDoNothing returns [] when a row already
  // exists for this org/day; fetch and return the existing (immutable) row.
  const [inserted] = await db()
    .insert(schema.reportSnapshots)
    .values(values)
    .onConflictDoNothing()
    .returning();

  if (inserted) return { snapshot: inserted, created: true };

  const [existing] = await db()
    .select()
    .from(schema.reportSnapshots)
    .where(
      and(
        eq(schema.reportSnapshots.organizationId, params.organizationId),
        eq(schema.reportSnapshots.snapshotDate, dateStr),
        eq(schema.reportSnapshots.snapshotType, 'eod'),
      ),
    )
    .limit(1);

  return { snapshot: existing, created: false };
}
