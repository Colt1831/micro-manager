import { pgTable, uuid, text, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, users } from './index';

// ─── Shifts ──────────────────────────────────────────────────
// Attendance envelope + guard for task timers (Phase 4). A shift is "open"
// while clock_out is NULL. Task timers remain the source of truth for worked
// time; the shift is the attendance window a timer must run inside.

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    clockIn: timestamp('clock_in').notNull(),
    clockOut: timestamp('clock_out'),
    source: varchar('source', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('idx_shifts_user').on(table.userId),
    orgIdx: index('idx_shifts_org').on(table.organizationId),
    // At most one *open* shift per user. Mirrors the running-timer partial
    // unique index: a DB-enforced invariant so concurrent clock-ins can't both
    // pass an app-level check and leave a user with two open shifts.
    oneOpenShiftPerUser: uniqueIndex('idx_shifts_one_open_per_user')
      .on(table.userId)
      .where(sql`${table.clockOut} is null`),
  }),
);
