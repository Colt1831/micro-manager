import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth } from '@/lib/auth/api-auth';
import { eq, and, isNull } from 'drizzle-orm';
export const runtime = 'nodejs';

// ─── GET /api/time-entries/running — Check if user has a running timer ──

export const GET = withAuth(
  async (_request: NextRequest, { user }) => {
    try {
      const [entry] = await db()
        .select({
          id: schema.timeEntries.id,
          taskId: schema.timeEntries.taskId,
          startTime: schema.timeEntries.startTime,
          description: schema.timeEntries.description,
          entryType: schema.timeEntries.entryType,
          task: {
            id: schema.tasks.id,
            title: schema.tasks.title,
            taskIdDisplay: schema.tasks.taskIdDisplay,
            status: schema.tasks.status,
          },
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
        .where(
          and(
            eq(schema.timeEntries.userId, user.id),
            isNull(schema.timeEntries.endTime),
            // Match the partial unique index: only timer entries are "running".
            eq(schema.timeEntries.entryType, 'timer'),
          ),
        )
        .limit(1);

      return NextResponse.json({
        running: !!entry,
        entry: entry ?? null,
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to check running timer');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'time-entries:running' },
);
