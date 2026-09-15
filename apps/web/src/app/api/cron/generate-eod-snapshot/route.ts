import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError } from '@/lib/api/db';
import { eq, and, isNull } from 'drizzle-orm';
import { generateEODSnapshotData, storeEODSnapshot } from '@/lib/reports/snapshots';
import { generateEODAISummary } from '@/lib/ai/eod-summary';
import { createNotification } from '@/lib/notifications';
import { isCronAuthorized } from '@/lib/api/cron-auth';

export const runtime = 'nodejs';

/**
 * POST /api/cron/generate-eod-snapshot
 *
 * Cron job that auto-generates an EOD report snapshot for every active
 * organization at the end of each day. Also generates an AI-powered
 * summary of the day's activity for each org.
 *
 * Security: Requires CRON_SECRET in Authorization header or ?token= query param.
 *
 * Set up to run daily at e.g. 5 PM (your local closing time):
 *   - cron-job.org: POST https://your-domain.com/api/cron/generate-eod-snapshot
 *   - Render Cron Jobs: POST /api/cron/generate-eod-snapshot
 *   - System crontab: `0 17 * * * /path/to/scripts/cron-generate-eod.sh`
 *
 * Response shape:
 *   {
 *     ok: true,
 *     timestamp: "...",
 *     results: {
 *       totalOrgs: number,
 *       processed: number,
 *       errors: number,
 *       orgs: [{ orgId, orgName, snapshotId, success, error? }]
 *     }
 *   }
 */
export const POST = async (request: NextRequest) => {
  try {
    // ── Auth (fails closed — see lib/api/cron-auth) ───────────
    if (!isCronAuthorized(request)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing CRON_SECRET' } },
        { status: 401 },
      );
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]!;

    // ── Fetch all active organizations ────────────────────────
    // Also fetch settings to check per-org EOD configuration
    const orgs = await db()
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        settings: schema.organizations.settings,
      })
      .from(schema.organizations)
      .where(
        and(
          eq(schema.organizations.isActive, true),
          isNull(schema.organizations.deletedAt),
        ),
      );

    const results: Array<{
      orgId: string;
      orgName: string;
      snapshotId?: string;
      action: 'generated' | 'skipped_time' | 'skipped_exists' | 'no_users' | 'error';
      error?: string;
    }> = [];

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    const currentHH = String(now.getHours()).padStart(2, '0');

    // ── Process each organization ──────────────────────────
    for (const org of orgs) {
      try {
        // ── Check per-org EOD settings before expensive work ──
        const orgSettings = (org.settings as Record<string, unknown>) ?? {};
        const eodSettings = (orgSettings.eod as Record<string, unknown>) ?? {};
        const preferredTime = (eodSettings.preferredTime as string) ?? '17:00';
        const preferredHH = preferredTime.split(':')[0] ?? '17';
        const aiSummaryEnabled = eodSettings.aiSummaryEnabled !== false;

        // Respect preferred time: skip orgs whose preferred hour doesn't
        // match the current hour. Run the cron at different times throughout
        // the day to cover different org schedules.
        if (currentHH !== preferredHH) {
          results.push({
            orgId: org.id,
            orgName: org.name,
            action: 'skipped_time',
          });
          skipped++;
          continue;
        }

        // ── Find an active user for the FK constraint ─────────
        const [firstUser] = await db()
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.organizationId, org.id),
              eq(schema.users.isActive, true),
              isNull(schema.users.deletedAt),
            ),
          )
          .limit(1);

        if (!firstUser) {
          results.push({
            orgId: org.id,
            orgName: org.name,
            action: 'no_users',
            error: 'No active users found in organization',
          });
          errors++;
          continue;
        }

        // ── Generate snapshot data ────────────────────────────
        const { snapshotData, summary } = await generateEODSnapshotData(
          org.id,
          firstUser.id,
        );

        // ── Generate AI summary (respecting org toggle) ────
        let aiSummary: string | null = null;
        if (aiSummaryEnabled) {
          try {
            aiSummary = await generateEODAISummary(org.id, summary);
          } catch {
            // Non-critical — snapshot is stored without AI summary
          }
        }

        const extendedSummary = { ...summary, aiSummary };

        // ── Store snapshot (idempotent per org/day) ───────────
        const { snapshot, created } = await storeEODSnapshot({
          organizationId: org.id,
          snapshotType: 'eod',
          label: `Auto-generated EOD Report - ${dateStr}`,
          snapshotData,
          summary: extendedSummary,
          generatedBy: firstUser.id,
        });

        // An EOD snapshot already existed for this org today (concurrent cron or
        // a manual generation) — treat as idempotent: no duplicate + no re-notify.
        if (!created) {
          results.push({
            orgId: org.id,
            orgName: org.name,
            snapshotId: snapshot?.id,
            action: 'skipped_exists',
          });
          skipped++;
          continue;
        }

        results.push({
          orgId: org.id,
          orgName: org.name,
          snapshotId: snapshot?.id,
          action: 'generated',
        });
        processed++;

        // ── Notify org users about the new EOD report ─────────
        try {
          // Find users with the admin role, falling back to all active users
          const adminRole = await db()
            .select({ id: schema.roles.id })
            .from(schema.roles)
            .where(
              and(
                eq(schema.roles.organizationId, org.id),
                eq(schema.roles.slug, 'admin'),
                isNull(schema.roles.deletedAt),
              ),
            )
            .limit(1);

          let notifyUserIds: string[];

          if (adminRole.length > 0) {
            const adminUsers = await db()
              .select({ userId: schema.userRoles.userId })
              .from(schema.userRoles)
              .where(eq(schema.userRoles.roleId, adminRole[0]!.id));

            notifyUserIds = adminUsers.map((u) => u.userId);
          } else {
            const allUsers = await db()
              .select({ id: schema.users.id })
              .from(schema.users)
              .where(
                and(
                  eq(schema.users.organizationId, org.id),
                  eq(schema.users.isActive, true),
                  isNull(schema.users.deletedAt),
                ),
              );
            notifyUserIds = allUsers.map((u) => u.id);
          }

          const notificationPromises = notifyUserIds.map((userId) =>
            createNotification({
              organizationId: org.id,
              userId,
              type: 'report.eod_ready',
              title: 'EOD Report Ready',
              message: `The daily EOD report has been generated for ${org.name}. View the snapshot on the Reports page.`,
              link: '/reports',
              entityType: 'report_snapshot',
              entityId: snapshot?.id ?? '',
              metadata: {
                snapshotId: snapshot?.id,
                date: dateStr,
                totalTasks: summary.totalTasks,
                completionRate: summary.completionRate,
                hasAiSummary: !!aiSummary,
              },
            }).catch((err) => {
              console.error(`[cron-eod] Failed to notify user ${userId}:`, err);
            }),
          );

          await Promise.allSettled(notificationPromises);
        } catch (notifErr) {
          console.error(`[cron-eod] Notification error for org ${org.id}:`, notifErr);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[cron-eod] Failed for org ${org.id} (${org.name}):`, errorMsg);
        results.push({
          orgId: org.id,
          orgName: org.name,
          action: 'error',
          error: errorMsg,
        });
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: now.toISOString(),
      date: dateStr,
      results: {
        totalOrgs: orgs.length,
        processed,
        skipped,
        errors,
        orgs: results,
      },
    });
  } catch (error) {
    const { error: err, status } = handleApiError(error, 'Failed to generate EOD snapshots');
    return NextResponse.json(err, { status });
  }
};

// GET /api/cron/generate-eod-snapshot - Also support GET for simpler cron setups
export const GET = async (request: NextRequest) => {
  return POST(request);
};
