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
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { organizations, users, departments, teams } from './index';
import { projects, milestones } from './projects';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    taskIdDisplay: varchar('task_id_display', { length: 30 }).notNull(),
    taskType: varchar('task_type', { length: 50 }).default('task'),
    projectId: uuid('project_id').references(() => projects.id),
    milestoneId: uuid('milestone_id').references(() => milestones.id),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id),
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id),
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    assignedBy: text('assigned_by').references(() => users.id),
    assignedTo: text('assigned_to').references(() => users.id),
    mentionedUserIds: text('mentioned_user_ids').array(),
    reviewers: text('reviewers').array(),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    priority: varchar('priority', { length: 20 }).default('medium'),
    category: varchar('category', { length: 100 }),
    labels: text('labels').array(),
    tags: text('tags').array(),
    startDate: timestamp('start_date'),
    dueDate: timestamp('due_date'),
    completedAt: timestamp('completed_at'),
    closedAt: timestamp('closed_at'),
    estimatedHours: decimal('estimated_hours', { precision: 8, scale: 2 }),
    actualHours: decimal('actual_hours', { precision: 8, scale: 2 }).default('0'),
    billable: boolean('billable').default(false),
    billableHours: decimal('billable_hours', { precision: 8, scale: 2 }).default('0'),
    approvalStatus: varchar('approval_status', { length: 50 }).default('pending'),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    slaDueAt: timestamp('sla_due_at'),
    slaBreached: boolean('sla_breached').default(false),
    completionSummary: text('completion_summary'),
    closureNotes: text('closure_notes'),
    closedBy: text('closed_by').references(() => users.id),
    isRecurring: boolean('is_recurring').default(false),
    recurrenceRule: text('recurrence_rule'),
    customFields: jsonb('custom_fields').default({}),
    isReadonly: boolean('is_readonly').default(false),
    sortOrder: decimal('sort_order', { precision: 12, scale: 4 }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('idx_tasks_org').on(table.organizationId),
    projectIdx: index('idx_tasks_project').on(table.projectId),
    assigneeIdx: index('idx_tasks_assigned_to').on(table.assignedTo),
    statusIdx: index('idx_tasks_status').on(table.status),
    priorityIdx: index('idx_tasks_priority').on(table.priority),
    dueDateIdx: index('idx_tasks_due_date').on(table.dueDate),
    displayIdIdx: index('idx_tasks_display_id').on(table.taskIdDisplay),
    parentIdx: index('idx_tasks_parent').on(table.parentTaskId),
    projectStatusIdx: index('idx_tasks_project_status').on(table.projectId, table.status),
    assignedStatusIdx: index('idx_tasks_assigned_status').on(table.assignedTo, table.status),
    departmentIdx: index('idx_tasks_department').on(table.departmentId),
  }),
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => users.id),
    assignedAt: timestamp('assigned_at').defaultNow(),
    isPrimary: boolean('is_primary').default(false),
  },
  (table) => ({
    taskUserUnique: uniqueIndex('idx_task_assignees_unique').on(table.taskId, table.userId),
  }),
);

export const taskHistory = pgTable(
  'task_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    field: varchar('field', { length: 100 }).notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changeType: varchar('change_type', { length: 50 }).notNull(),
    description: text('description'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('idx_task_history_task').on(table.taskId, table.createdAt),
    userIdx: index('idx_task_history_user').on(table.userId),
  }),
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    contentPlain: text('content_plain'),
    isInternalNote: boolean('is_internal_note').default(false),
    parentId: uuid('parent_id').references((): AnyPgColumn => taskComments.id),
    editedAt: timestamp('edited_at'),
    isEdited: boolean('is_edited').default(false),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    taskIdx: index('idx_task_comments_task').on(table.taskId, table.createdAt),
    userIdx: index('idx_task_comments_user').on(table.userId),
    parentIdx: index('idx_task_comments_parent').on(table.parentId),
  }),
);

export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    fileSize: integer('file_size'),
    mimeType: varchar('mime_type', { length: 100 }),
    storageKey: text('storage_key').notNull(),
    isFinal: boolean('is_final').default(false),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    taskIdx: index('idx_task_attachments_task').on(table.taskId),
  }),
);

export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    isChecked: boolean('is_checked').default(false),
    checkedBy: text('checked_by').references(() => users.id),
    checkedAt: timestamp('checked_at'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('idx_task_checklist_task').on(table.taskId),
  }),
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    dependencyType: varchar('dependency_type', { length: 50 }).default('blocks'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskDepUnique: uniqueIndex('idx_task_deps_unique').on(table.taskId, table.dependsOnTaskId),
  }),
);

export const taskWatchers = pgTable(
  'task_watchers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchType: varchar('watch_type', { length: 50 }).default('watching'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskUserUnique: uniqueIndex('idx_task_watchers_unique').on(table.taskId, table.userId),
  }),
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    durationMinutes: integer('duration_minutes'),
    billableMinutes: integer('billable_minutes'),
    entryType: varchar('entry_type', { length: 50 }).default('manual'),
    description: text('description'),
    isApproved: boolean('is_approved').default(false),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    isCorrection: boolean('is_correction').default(false),
    correctedEntryId: uuid('corrected_entry_id').references((): AnyPgColumn => timeEntries.id),
    correctionReason: text('correction_reason'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('idx_time_entries_task').on(table.taskId),
    userIdx: index('idx_time_entries_user').on(table.userId),
    userDateIdx: index('idx_time_entries_user_date').on(table.userId, table.startTime),
    // At most one *running* timer per user. A partial unique index makes this a
    // DB-enforced invariant so concurrent "start timer" requests can't both pass
    // an app-level check-then-insert and leave a user with two running timers
    // (WM-011). Only timer-type entries with no end_time are constrained.
    oneRunningTimerPerUser: uniqueIndex('idx_time_entries_one_running_timer')
      .on(table.userId)
      .where(sql`${table.endTime} is null and ${table.entryType} = 'timer'`),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tasks.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  milestone: one(milestones, { fields: [tasks.milestoneId], references: [milestones.id] }),
  assignee: one(users, { fields: [tasks.assignedTo], references: [users.id] }),
  creator: one(users, { fields: [tasks.createdBy], references: [users.id] }),
  history: many(taskHistory),
  comments: many(taskComments),
  checklistItems: many(taskChecklistItems),
}));
