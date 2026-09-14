import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth, requirePermission, type DeptScope } from '@/lib/auth/api-auth';
import { and, gte, lte, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { applyDeptScope } from '@/lib/api/db';

export const runtime = 'nodejs';

// ─── Types ──────────────────────────────────────────────────

interface AnalyticsQuery {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  groupBy?: 'day' | 'week' | 'month';
}

interface BurndownPoint {
  date: string;
  ideal: number;
  actual: number;
  remaining: number;
}

interface VelocityPoint {
  period: string;
  completed: number;
  created: number;
  totalPoints?: number;
}

interface TrendData {
  completionRate: number;
  overdueRate: number;
  avgCompletionDays: number | null;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  inProgressTasks: number;
  openTasks: number;
  blockedTasks: number;
  statusDistribution: Array<{ status: string; count: number }>;
}

interface AnalyticsResponse {
  burndown: BurndownPoint[];
  velocity: VelocityPoint[];
  trends: TrendData;
}

// ─── Helpers ────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function formatWeekLabel(d: Date): string {
  const start = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDate = new Date(d);
  endDate.setDate(endDate.getDate() + 6);
  const end = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${start} - ${end}`;
}

// ─── Analytics Logic ────────────────────────────────────────

async function computeTrends(
  orgId: string,
  startDate: Date,
  endDate: Date,
  scope: DeptScope,
  projectId?: string,
): Promise<TrendData> {
  const db = getDb();

  // Base conditions for the org + department wall.
  const baseConditions: SQL[] = [
    eq(schema.tasks.organizationId, orgId),
    isNull(schema.tasks.deletedAt),
  ];
  applyDeptScope(baseConditions, scope, schema.tasks.departmentId);
  if (projectId) baseConditions.push(eq(schema.tasks.projectId, projectId));

  // Total tasks in range
  const dateRangeConditions = [
    ...baseConditions,
    gte(schema.tasks.createdAt, startDate),
    lte(schema.tasks.createdAt, endDate),
  ];

  const allTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(...dateRangeConditions));

  const totalTasks = allTasks[0]?.count ?? 0;

  // Completed tasks
  const completedTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(
      and(
        ...dateRangeConditions,
        eq(schema.tasks.status, 'completed'),
      ),
    );

  const completedCount = completedTasks[0]?.count ?? 0;

  // Overdue tasks (dueDate past, not terminal)
  const now = new Date();
  const overdueTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(
      and(
        ...baseConditions,
        isNull(schema.tasks.deletedAt),
        sql`${schema.tasks.dueDate} IS NOT NULL`,
        // toISOString(): the postgres driver rejects a raw Date interpolated
        // into a sql template — must be a string param.
        sql`${schema.tasks.dueDate} < ${now.toISOString()}`,
        sql`${schema.tasks.status} NOT IN ('completed', 'closed', 'cancelled', 'archived')`,
      ),
    );

  const overdueCount = overdueTasks[0]?.count ?? 0;

  // In progress, open, blocked counts
  const inProgressTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(...baseConditions, eq(schema.tasks.status, 'in_progress')));

  const openTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(...baseConditions, eq(schema.tasks.status, 'open')));

  const blockedTasks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(...baseConditions, eq(schema.tasks.status, 'blocked')));

  // Average completion time (days between createdAt and completedAt)
  const avgCompletion = await db
    .select({ avg: sql<number | null>`avg(extract(epoch from (completed_at - created_at)) / 86400)` })
    .from(schema.tasks)
    .where(
      and(
        ...baseConditions,
        eq(schema.tasks.status, 'completed'),
        sql`${schema.tasks.completedAt} IS NOT NULL`,
      ),
    );

  const avgDays = avgCompletion[0]?.avg ?? null;

  // Status distribution
  const statusDistribution = await db
    .select({
      status: schema.tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.tasks)
    .where(and(...baseConditions))
    .groupBy(schema.tasks.status)
    .orderBy(schema.tasks.status);

  return {
    completionRate: totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0,
    overdueRate: totalTasks > 0 ? Math.round((overdueCount / totalTasks) * 100) : 0,
    avgCompletionDays: avgDays != null ? Math.round(avgDays * 10) / 10 : null,
    totalTasks,
    completedTasks: completedCount,
    overdueTasks: overdueCount,
    inProgressTasks: inProgressTasks[0]?.count ?? 0,
    openTasks: openTasks[0]?.count ?? 0,
    blockedTasks: blockedTasks[0]?.count ?? 0,
    statusDistribution,
  };
}

async function computeBurndown(
  orgId: string,
  startDate: Date,
  endDate: Date,
  scope: DeptScope,
  projectId?: string,
): Promise<BurndownPoint[]> {
  const db = getDb();
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));

  const baseConditions: SQL[] = [
    eq(schema.tasks.organizationId, orgId),
    isNull(schema.tasks.deletedAt),
  ];
  applyDeptScope(baseConditions, scope, schema.tasks.departmentId);
  if (projectId) baseConditions.push(eq(schema.tasks.projectId, projectId));

  // Total tasks created before or during this period
  const totalInPeriod = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(
      and(
        ...baseConditions,
        lte(schema.tasks.createdAt, endDate),
      ),
    );
  const totalTasks = totalInPeriod[0]?.count ?? 0;

  // Get completion dates of tasks completed during the period
  const completedInPeriod = await db
    .select({
      completedAt: schema.tasks.completedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        ...baseConditions,
        eq(schema.tasks.status, 'completed'),
        sql`${schema.tasks.completedAt} IS NOT NULL`,
        gte(schema.tasks.completedAt, startDate),
        lte(schema.tasks.completedAt, endDate),
      ),
    );

  // Build completion map
  const completedByDate = new Map<string, number>();
  for (const task of completedInPeriod) {
    if (task.completedAt) {
      const dateKey = formatDate(new Date(task.completedAt));
      completedByDate.set(dateKey, (completedByDate.get(dateKey) ?? 0) + 1);
    }
  }

  // Generate burndown points for each day
  const points: BurndownPoint[] = [];
  let completedSoFar = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    const dateKey = formatDate(current);
    const dayCompleted = completedByDate.get(dateKey) ?? 0;
    completedSoFar += dayCompleted;

    const remaining = totalTasks - completedSoFar;
    const daysElapsed = Math.ceil((current.getTime() - startDate.getTime()) / 86400000);
    const idealRemaining = Math.max(0, totalTasks - (totalTasks / totalDays) * daysElapsed);

    points.push({
      date: dateKey,
      ideal: Math.round(idealRemaining * 10) / 10,
      actual: remaining,
      remaining,
    });

    current.setDate(current.getDate() + 1);
  }

  return points;
}

async function computeVelocity(
  orgId: string,
  startDate: Date,
  endDate: Date,
  scope: DeptScope,
  projectId?: string,
): Promise<VelocityPoint[]> {
  const db = getDb();

  const baseConditions: SQL[] = [
    eq(schema.tasks.organizationId, orgId),
    isNull(schema.tasks.deletedAt),
  ];
  applyDeptScope(baseConditions, scope, schema.tasks.departmentId);
  if (projectId) baseConditions.push(eq(schema.tasks.projectId, projectId));

  const points: VelocityPoint[] = [];
  const current = new Date(getMonday(startDate));

   
  while (current <= endDate) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Tasks completed this week
    const completed = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(
        and(
          ...baseConditions,
          eq(schema.tasks.status, 'completed'),
          gte(schema.tasks.completedAt, weekStart),
          lte(schema.tasks.completedAt, weekEnd),
        ),
      );

    // Tasks created this week
    const created = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(
        and(
          ...baseConditions,
          gte(schema.tasks.createdAt, weekStart),
          lte(schema.tasks.createdAt, weekEnd),
        ),
      );

    points.push({
      period: formatWeekLabel(weekStart),
      completed: completed[0]?.count ?? 0,
      created: created[0]?.count ?? 0,
    });

    current.setDate(current.getDate() + 7);
  }

  return points;
}

// ─── Route ──────────────────────────────────────────────────

// POST /api/analytics - Compute analytics data
export const POST = withAuth(
  async (request: Request, { user, orgId, scope }) => {
    try {
      await requirePermission(user.id, 'report:view');

      const body: AnalyticsQuery = await request.json();

      // Default to last 30 days
      const endDate = body.endDate ? new Date(body.endDate) : new Date();
      const startDate = body.startDate
        ? new Date(body.startDate)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const projectId = body.projectId;

      const [trends, burndown, velocity] = await Promise.all([
        computeTrends(orgId!, startDate, endDate, scope, projectId),
        computeBurndown(orgId!, startDate, endDate, scope, projectId),
        computeVelocity(orgId!, startDate, endDate, scope, projectId),
      ]);

      const response: AnalyticsResponse = {
        burndown,
        velocity,
        trends,
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('[analytics] Error:', error);
      return NextResponse.json(
        { error: { code: 'ANALYTICS_ERROR', message: 'Failed to compute analytics' } },
        { status: 500 },
      );
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'analytics:compute' },
);
