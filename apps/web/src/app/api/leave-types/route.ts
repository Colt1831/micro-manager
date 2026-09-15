import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@workmanagement/database';
import { withAuth } from '@/lib/auth/api-auth';
import { eq, and, asc } from 'drizzle-orm';
import { handleApiError } from '@/lib/api/db';

export const runtime = 'nodejs';

// GET /api/leave-types — List active leave types for the org.
// Read-only: default types are seeded by packages/database/src/seed.ts, NOT
// created here (a GET must not mutate). No trust of client headers.
export const GET = withAuth(
  async (_request: NextRequest, { orgId }) => {
    try {
      const db = getDb();
      const types = await db
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.organizationId, orgId!),
            eq(schema.leaveTypes.isActive, true),
          ),
        )
        .orderBy(asc(schema.leaveTypes.sortOrder));

      return NextResponse.json({ types });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch leave types');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 100, namespace: 'leave:types' },
);
