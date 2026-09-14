import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, applyDeptScope } from '@/lib/api/db';
import { withAuth } from '@/lib/auth/api-auth';
import { eq, and, isNull, isNotNull, sql, gte, type SQL } from 'drizzle-orm';

export const runtime = 'nodejs';

// ─── GET /api/reports/time — Time tracking report data ──────────

export const GET = withAuth(
  async (request: NextRequest, { user: _user, orgId, scope }) => {
    try {
      const { searchParams } = request.nextUrl;
      const period = searchParams.get('period') ?? 'week'; // week | month | quarter

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      let periodStart: Date;
      switch (period) {
        case 'month':
          periodStart = new Date(startOfDay.getTime() - 30 * 86_400_000);
          break;
        case 'quarter':
          periodStart = new Date(startOfDay.getTime() - 90 * 86_400_000);
          break;
        default: // week
          periodStart = new Date(startOfDay.getTime() - 7 * 86_400_000);
      }

      // Shared filter for every aggregation. Department wall: a walled manager
      // only sees their department's time (scoped via the task's department);
      // GM+/super_admin see the whole org. Fresh array per call — applyDeptScope
      // mutates it, so it must not be shared by reference across queries.
      const baseConditions = (): SQL[] => {
        const c: SQL[] = [
          eq(schema.tasks.organizationId, orgId!),
          gte(schema.timeEntries.startTime, periodStart),
          isNull(schema.tasks.deletedAt),
          isNotNull(schema.timeEntries.durationMinutes),
        ];
        applyDeptScope(c, scope, schema.tasks.departmentId);
        return c;
      };

      // ── Hours by day ──────────────────────────────────
      const dailyHours = await db()
        .select({
          date: sql<string>`date(${schema.timeEntries.startTime})`,
          totalMinutes: sql<number>`coalesce(sum(${schema.timeEntries.durationMinutes}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(and(...baseConditions()))
        .groupBy(sql`date(${schema.timeEntries.startTime})`)
        .orderBy(sql`date(${schema.timeEntries.startTime})`);

      // ── Hours by user ─────────────────────────────────
      const userHours = await db()
        .select({
          userId: schema.timeEntries.userId,
          userName: schema.users.name,
          totalMinutes: sql<number>`coalesce(sum(${schema.timeEntries.durationMinutes}), 0)`,
          entryCount: sql<number>`count(*)`,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .leftJoin(schema.users, eq(schema.timeEntries.userId, schema.users.id))
        .where(and(...baseConditions()))
        .groupBy(schema.timeEntries.userId, schema.users.name)
        .orderBy(sql`coalesce(sum(${schema.timeEntries.durationMinutes}), 0) desc`)
        .limit(20);

      // ── Hours by project ──────────────────────────────
      const projectHours = await db()
        .select({
          projectId: schema.projects.id,
          projectName: schema.projects.name,
          totalMinutes: sql<number>`coalesce(sum(${schema.timeEntries.durationMinutes}), 0)`,
          entryCount: sql<number>`count(*)`,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .leftJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
        .where(and(...baseConditions(), isNotNull(schema.tasks.projectId)))
        .groupBy(schema.projects.id, schema.projects.name)
        .orderBy(sql`coalesce(sum(${schema.timeEntries.durationMinutes}), 0) desc`)
        .limit(20);

      // ── Top tasks by hours ────────────────────────────
      const topTasks = await db()
        .select({
          taskId: schema.tasks.id,
          taskTitle: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          totalMinutes: sql<number>`coalesce(sum(${schema.timeEntries.durationMinutes}), 0)`,
          entryCount: sql<number>`count(*)`,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(and(...baseConditions()))
        .groupBy(schema.tasks.id, schema.tasks.title, schema.tasks.taskIdDisplay)
        .orderBy(sql`coalesce(sum(${schema.timeEntries.durationMinutes}), 0) desc`)
        .limit(20);

      // ── Grand total ───────────────────────────────────
      const [totalResult] = await db()
        .select({
          totalMinutes: sql<number>`coalesce(sum(${schema.timeEntries.durationMinutes}), 0)`,
          entryCount: sql<number>`count(*)`,
          avgSession: sql<number>`coalesce(avg(${schema.timeEntries.durationMinutes}), 0)`,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(and(...baseConditions()));

      return NextResponse.json({
        period,
        periodStart: periodStart.toISOString(),
        periodEnd: now.toISOString(),
        totalHours: Number(((totalResult?.totalMinutes ?? 0) / 60).toFixed(1)),
        totalMinutes: Number(totalResult?.totalMinutes ?? 0),
        entryCount: Number(totalResult?.entryCount ?? 0),
        avgSessionMinutes: Math.round(Number(totalResult?.avgSession ?? 0)),
        dailyHours: dailyHours.map((d) => ({
          date: d.date,
          hours: Number((d.totalMinutes / 60).toFixed(1)),
          totalMinutes: Number(d.totalMinutes),
          count: Number(d.count),
        })),
        byUser: userHours.map((u) => ({
          userId: u.userId,
          userName: u.userName ?? 'Unknown',
          hours: Number((u.totalMinutes / 60).toFixed(1)),
          totalMinutes: Number(u.totalMinutes),
          entryCount: Number(u.entryCount),
        })),
        byProject: projectHours.map((p) => ({
          projectId: p.projectId ?? '',
          projectName: p.projectName ?? 'No Project',
          hours: Number((p.totalMinutes / 60).toFixed(1)),
          totalMinutes: Number(p.totalMinutes),
          entryCount: Number(p.entryCount),
        })),
        topTasks: topTasks.map((t) => ({
          taskId: t.taskId,
          title: t.taskTitle,
          taskIdDisplay: t.taskIdDisplay,
          hours: Number((t.totalMinutes / 60).toFixed(1)),
          totalMinutes: Number(t.totalMinutes),
          entryCount: Number(t.entryCount),
        })),
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch time reports');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 120_000, max: 20, namespace: 'reports:time' },
);
