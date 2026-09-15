import { pgTable, uuid, text, varchar, timestamp, jsonb, date, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { organizations, users } from './index';

// ─── Report Snapshots ──────────────────────────────────────────
// IMMUTABLE — End-of-Day report snapshots.
// Once inserted, rows must never be updated or deleted.
// This provides a verifiable, timestamped record of what
// the report data looked like at a point in time.
//
// Security invariants:
// - No UPDATE/DELETE API routes (insert-only)
// - No soft-delete column (rows are never removed)
// - Database-level RLS or trigger can enforce immutability
// - Audit trail captured via audit_logs with REPORT_GENERATED action

export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    snapshotDate: date('snapshot_date').notNull(),
    snapshotType: varchar('snapshot_type', { length: 50 }).notNull().default('eod'),
    label: varchar('label', { length: 255 }),
    /** The full report data as a JSON blob */
    snapshotData: jsonb('snapshot_data').notNull(),
    /** Summary metrics extracted for quick reference */
    summary: jsonb('summary').default({}),
    generatedBy: text('generated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // NOTE: deliberately no updatedAt or deletedAt — rows are immutable
  },
  (table) => ({
    orgIdx: index('idx_report_snapshots_org').on(table.organizationId, table.snapshotDate),
    typeDateIdx: index('idx_report_snapshots_type_date').on(table.snapshotType, table.snapshotDate),
    dateIdx: index('idx_report_snapshots_date').on(table.snapshotDate),
    // At most one 'eod' snapshot per org per day — makes cron/manual generation
    // idempotent. Partial so non-eod snapshot types are unaffected.
    eodUnique: uniqueIndex('idx_report_snapshots_eod_unique')
      .on(table.organizationId, table.snapshotDate)
      .where(sql`${table.snapshotType} = 'eod'`),
  }),
);

// ─── Relations ───────────────────────────────────────────────

export const reportSnapshotsRelations = relations(reportSnapshots, ({ one }) => ({
  organization: one(organizations, {
    fields: [reportSnapshots.organizationId],
    references: [organizations.id],
  }),
  generator: one(users, {
    fields: [reportSnapshots.generatedBy],
    references: [users.id],
  }),
}));

// ─── Snapshot Data Type ──────────────────────────────────────

export interface ReportSnapshotData {
  timestamp: string;
  generatedBy: string;
  organizationId: string;
  date: string;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    completedThisPeriod: number;
    createdThisPeriod: number;
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
