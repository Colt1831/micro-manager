import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations, users } from './index';

// ─── Leave Types ─────────────────────────────────────────────
//
// Predefined leave types for an organization (Vacation, Sick, Personal).
// Admins can also create custom types.

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    description: text('description'),
    color: varchar('color', { length: 7 }).notNull().default('#6366f1'),
    icon: varchar('icon', { length: 50 }).default('CalendarDays'),
    requiresAttachment: boolean('requires_attachment').default(false),
    isActive: boolean('is_active').default(true),
    sortOrder: integer('sort_order').default(0),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('idx_leave_types_org').on(table.organizationId),
    orgSlugUnique: uniqueIndex('idx_leave_types_org_slug').on(table.organizationId, table.slug),
  }),
);

// ─── Leave Balances ──────────────────────────────────────────
//
// Tracks allocated vs used leave days per user, per type, per year.
// Admins manually allocate balances at the start of the year (or on hire).
// usedDays and pendingDays are updated automatically by the system.

export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    // numeric (not integer): the system moves half-day (0.5) increments through
    // these columns; an integer column silently truncated them (Phase 5). mode
    // 'number' maps pg's string-typed numeric back to a JS number at the driver
    // boundary, so callers never see a '0.5' string and never string-concat.
    allocatedDays: numeric('allocated_days', { precision: 6, scale: 1, mode: 'number' })
      .notNull()
      .default(0),
    usedDays: numeric('used_days', { precision: 6, scale: 1, mode: 'number' })
      .notNull()
      .default(0),
    pendingDays: numeric('pending_days', { precision: 6, scale: 1, mode: 'number' })
      .notNull()
      .default(0),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('idx_leave_balances_org').on(table.organizationId),
    userIdx: index('idx_leave_balances_user').on(table.userId),
    typeIdx: index('idx_leave_balances_type').on(table.leaveTypeId),
    userYearTypeUnique: uniqueIndex('idx_leave_balances_user_year_type').on(
      table.userId,
      table.year,
      table.leaveTypeId,
    ),
  }),
);

// ─── Leave Requests ──────────────────────────────────────────
//
// Each row is a single time-off request. Workflow:
//   pending → approved (balance deducted) OR rejected
//   pending → cancelled (by requester)

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isHalfDay: boolean('is_half_day').default(false),
    // numeric (not integer): the API writes 0.5 for half-days — integer rounded.
    daysCount: numeric('days_count', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNote: text('review_note'),
    cancelledBy: text('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at'),
    attachmentUrl: text('attachment_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('idx_leave_reqs_org').on(table.organizationId, table.status),
    userIdx: index('idx_leave_reqs_user').on(table.userId, table.createdAt),
    statusIdx: index('idx_leave_reqs_status').on(table.status),
    reviewerIdx: index('idx_leave_reqs_reviewer').on(table.reviewedBy),
    dateRangeIdx: index('idx_leave_reqs_dates').on(table.startDate, table.endDate),
  }),
);

// ─── Relations ───────────────────────────────────────────────

export const leaveTypesRelations = relations(leaveTypes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leaveTypes.organizationId],
    references: [organizations.id],
  }),
  balances: many(leaveBalances),
  requests: many(leaveRequests),
}));

export const leaveBalancesRelations = relations(leaveBalances, ({ one }) => ({
  organization: one(organizations, {
    fields: [leaveBalances.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [leaveBalances.userId],
    references: [users.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveBalances.leaveTypeId],
    references: [leaveTypes.id],
  }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [leaveRequests.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [leaveRequests.userId],
    references: [users.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveRequests.leaveTypeId],
    references: [leaveTypes.id],
  }),
  reviewer: one(users, {
    fields: [leaveRequests.reviewedBy],
    references: [users.id],
  }),
}));
