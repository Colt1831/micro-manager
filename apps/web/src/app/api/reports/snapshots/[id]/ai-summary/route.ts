import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, enforceOrgScope, requirePermission } from '@/lib/auth/api-auth';
import { eq } from 'drizzle-orm';
import { generateEODAISummary } from '@/lib/ai/eod-summary';
import type { SnapshotSummary } from '@/lib/reports/snapshots';

export const runtime = 'nodejs';

function getIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/');
  // /api/reports/snapshots/[id]/ai-summary → [id] is at index 4
  return segments[4]!;
}

// POST /api/reports/snapshots/[id]/ai-summary
// Generate (or regenerate) an AI summary for a specific snapshot.
// Rate limited: 20 req/min per user.
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'report:create');

      const id = getIdFromPath(request);

      // ── Fetch snapshot ──────────────────────────────────
      const [snapshot] = await db()
        .select()
        .from(schema.reportSnapshots)
        .where(eq(schema.reportSnapshots.id, id))
        .limit(1);

      if (!snapshot) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Report snapshot not found' } },
          { status: 404 },
        );
      }

      enforceOrgScope(snapshot.organizationId, orgId);

      // ── Extract stored summary ──────────────────────────
      const currentSummary = snapshot.summary as Record<string, unknown> | null;

      const storedSummary: SnapshotSummary = {
        totalTasks: (currentSummary?.totalTasks as number) ?? 0,
        completedCount: (currentSummary?.completedCount as number) ?? 0,
        overdueCount: (currentSummary?.overdueCount as number) ?? 0,
        activeProjects: (currentSummary?.activeProjects as number) ?? 0,
        totalUsers: (currentSummary?.totalUsers as number) ?? 0,
        completionRate: (currentSummary?.completionRate as number) ?? 0,
      };

      // ── Generate AI summary (generate-on-read; the snapshot is IMMUTABLE
      // so we never persist back to the stored row) ──────────
      const aiSummary = await generateEODAISummary(orgId, storedSummary);

      if (!aiSummary) {
        return NextResponse.json(
          {
            error: {
              code: 'AI_ERROR',
              message:
                'Failed to generate AI summary — no API key configured or AI service unavailable.',
            },
          },
          { status: 502 },
        );
      }

      // Return the freshly-generated summary WITHOUT mutating the immutable
      // snapshot. Clients render this transient result.
      const generatedSummary = { ...currentSummary, aiSummary };

      return NextResponse.json({
        message: 'AI summary generated',
        summary: generatedSummary,
      });
    } catch (error) {
      const { error: err, status } = handleApiError(
        error,
        'Failed to generate AI summary',
      );
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'reports:snapshots:ai-summary' },
);
