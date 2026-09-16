import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth } from '@/lib/auth/api-auth';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

// ─── GET /api/login-history — Current user's recent sign-ins ──
// Returns the authenticated user's own login history, newest first,
// capped at 20. Scoped strictly to the caller's userId — no cross-user reads.

export const GET = withAuth(
  async (_request: NextRequest, { user }) => {
    try {
      const logins = await db()
        .select({
          id: schema.loginHistory.id,
          ipAddress: schema.loginHistory.ipAddress,
          userAgent: schema.loginHistory.userAgent,
          loginMethod: schema.loginHistory.loginMethod,
          success: schema.loginHistory.success,
          createdAt: schema.loginHistory.createdAt,
        })
        .from(schema.loginHistory)
        .where(eq(schema.loginHistory.userId, user.id))
        .orderBy(desc(schema.loginHistory.createdAt))
        .limit(20);

      return NextResponse.json({ logins });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch login history');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'login-history:list' },
);
