import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations, users, departments, teams } from './index';

// ─── Projects ────────────────────────────────────────────────

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 300 }).notNull(),
    code: varchar('code', { length: 20 }),
    description: text('description'),

    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    departmentId: uuid('department_id').references(() => departments.id),
    teamId: uuid('team_id').references(() => teams.id),

    status: varchar('status', { length: 50 }).default('active'),
    priority: varchar('priority', { length: 20 }).default('medium'),
    progress: integer('progress').default(0),
    completionPercentage: decimal('completion_percentage', { precision: 5, scale: 2 }).default('0'),

    startDate: date('start_date'),
    endDate: date('end_date'),
    actualEndDate: date('actual_end_date'),

    budgetAmount: decimal('budget_amount', { precision: 15, scale: 2 }),
    budgetCurrency: varchar('budget_currency', { length: 3 }).default('USD'),

    tags: text('tags').array(),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('idx_projects_org').on(table.organizationId),
    ownerIdx: index('idx_projects_owner').on(table.ownerId),
    statusIdx: index('idx_projects_status').on(table.status),
    codeIdx: index('idx_projects_code').on(table.code),
    departmentIdx: index('idx_projects_department').on(table.departmentId),
  }),
);

// ─── Milestones ─────────────────────────────────────────────

export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 300 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 50 }).default('pending'),
    dueDate: date('due_date'),
    completedDate: date('completed_date'),
    sortOrder: integer('sort_order').default(0),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    projectIdx: index('idx_milestones_project').on(table.projectId),
  }),
);

// ─── Relations ───────────────────────────────────────────────

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  department: one(departments, {
    fields: [projects.departmentId],
    references: [departments.id],
  }),
  team: one(teams, {
    fields: [projects.teamId],
    references: [teams.id],
  }),
  milestones: many(milestones),
}));

export const milestonesRelations = relations(milestones, ({ one }) => ({
  project: one(projects, {
    fields: [milestones.projectId],
    references: [projects.id],
  }),
}));
