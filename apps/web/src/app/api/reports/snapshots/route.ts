import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { createAuditEntry } from '@/lib/audit';
import { eq, desc, and, sql } from 'drizzle-orm';
import { generateEODSnapshotData, storeEODSnapshot } from '@/lib/reports/snapshots';
import { generateEODAISummary } from '@/lib/ai/eod-summary';

export const runtime = 'nodejs';

// GET /api/reports/snapshots - List available report snapshots (rate limited: 60 req/min per user)
export const GET = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'report:view');

      const { searchParams } = new URL(request.url);
      const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 100);
      const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
      const type = searchParams.get('type'); // optional filter: 'eod' | 'weekly' | etc.

      const conditions = [eq(schema.reportSnapshots.organizationId, orgId!)];
      if (type) conditions.push(eq(schema.reportSnapshots.snapshotType, type));

      const snapshots = await db()
        .select({
          id: schema.reportSnapshots.id,
          snapshotDate: schema.reportSnapshots.snapshotDate,
          snapshotType: schema.reportSnapshots.snapshotType,
          label: schema.reportSnapshots.label,
          summary: schema.reportSnapshots.summary,
          generatedBy: schema.reportSnapshots.generatedBy,
          createdAt: schema.reportSnapshots.createdAt,
        })
        .from(schema.reportSnapshots)
        .where(and(...conditions))
        .orderBy(desc(schema.reportSnapshots.snapshotDate), desc(schema.reportSnapshots.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalResult] = await db()
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(schema.reportSnapshots)
        .where(and(...conditions));

      return NextResponse.json({
        snapshots,
        total: totalResult?.total ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch report snapshots');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 60, namespace: 'reports:snapshots:list' },
);

// POST /api/reports/snapshots - Generate and store an immutable EOD report snapshot
export const POST = withAuth(
  async (request: NextRequest, { user, orgId }) => {
    try {
      await requirePermission(user.id, 'report:create');

      const body = await request.json().catch(() => ({}));
      const { label, snapshotType = 'eod' } = body;

      // ── Gather snapshot data using shared library ─────────
      const { snapshotData, summary } = await generateEODSnapshotData(orgId!, user.id);

      // ── Generate AI summary BEFORE insert so the stored row is immutable ──
      // (no post-insert mutation). On AI failure we store without a summary and
      // never mutate the snapshot later.
      let aiSummary: string | null = null;
      try {
        aiSummary = await generateEODAISummary(orgId, summary);
      } catch {
        // Non-critical — snapshot stored without an AI summary.
      }
      const summaryWithAI = { ...summary, aiSummary };

      // ── Store immutable snapshot (idempotent for eod) ─────
      const { snapshot } = await storeEODSnapshot({
        organizationId: orgId!,
        snapshotType,
        label: label ?? null,
        snapshotData,
        summary: summaryWithAI,
        generatedBy: user.id,
      });

      if (!snapshot) {
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed to create report snapshot' } },
          { status: 500 },
        );
      }

      // Audit log
      await createAuditEntry({
        organizationId: orgId,
        userId: user.id,
        action: 'report.generated',
        entityType: 'report_snapshot',
        entityId: snapshot.id,
        newValues: {
          date: snapshotData.date,
          type: snapshotType,
          totalTasks: summary.totalTasks,
          completedCount: summary.completedCount,
        },
        metadata: { summary },
      });

      return NextResponse.json({ snapshot }, { status: 201 });
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to generate report snapshot');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 20, namespace: 'reports:snapshots:create' },
);
