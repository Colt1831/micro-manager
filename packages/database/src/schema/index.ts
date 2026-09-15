import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  date,
  uniqueIndex,
  index,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Custom Types ────────────────────────────────────────────

const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

// ─── Organizations ───────────────────────────────────────────

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    logoUrl: text('logo_url'),
    domain: varchar('domain', { length: 255 }),
    settings: jsonb('settings').default({}),
    maxUsers: integer('max_users'),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    slugIdx: uniqueIndex('idx_orgs_slug').on(table.slug),
    domainIdx: index('idx_orgs_domain').on(table.domain),
  }),
);

// ─── Users ───────────────────────────────────────────────────
// Note: id is text because Better Auth generates string IDs (not UUIDs)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: citext('email').notNull().unique(),
    name: varchar('name', { length: 200 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    displayName: varchar('display_name', { length: 200 }),
    avatarUrl: text('avatar_url'),
    phone: varchar('phone', { length: 50 }),

    organizationId: uuid('organization_id').references(() => organizations.id),

    designation: varchar('designation', { length: 200 }),
    employeeId: varchar('employee_id', { length: 50 }),
    employmentStatus: varchar('employment_status', { length: 50 }).default('active'),
    // Organizational rank (authority + scope). One per user. See
    // packages/shared/src/constants/rank.ts for the level map and rules.
    rank: varchar('rank', { length: 50 }).default('executive'),
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id),
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id),
    reportingManagerId: text('reporting_manager_id').references((): AnyPgColumn => users.id),
    location: varchar('location', { length: 255 }),
    timezone: varchar('timezone', { length: 50 }).default('UTC'),
    dateJoined: date('date_joined'),

    emailVerified: boolean('email_verified').default(false),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    twoFactorSecret: text('two_factor_secret'),
    lastLoginAt: timestamp('last_login_at'),
    lastLoginIp: inet('last_login_ip'),

    isActive: boolean('is_active').default(true),
    isSuspended: boolean('is_suspended').default(false),
    isArchived: boolean('is_archived').default(false),
    suspensionReason: text('suspension_reason'),
    archivedAt: timestamp('archived_at'),

    preferences: jsonb('preferences').default({}),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    emailIdx: uniqueIndex('idx_users_email').on(table.email),
    orgIdx: index('idx_users_org').on(table.organizationId),
    deptIdx: index('idx_users_department').on(table.departmentId),
    teamIdx: index('idx_users_team').on(table.teamId),
    mgrIdx: index('idx_users_manager').on(table.reportingManagerId),
    statusIdx: index('idx_users_status').on(table.employmentStatus),
    activeIdx: index('idx_users_active').on(table.isActive),
  }),
);

// ─── Departments ─────────────────────────────────────────────

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    headUserId: text('head_user_id').references(() => users.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id),
    isActive: boolean('is_active').default(true),
    sortOrder: integer('sort_order').default(0),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('idx_depts_org').on(table.organizationId),
    parentIdx: index('idx_depts_parent').on(table.parentId),
    uniqueOrgName: uniqueIndex('idx_depts_org_name').on(table.organizationId, table.name),
  }),
);

// ─── Teams ───────────────────────────────────────────────────

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    departmentId: uuid('department_id').references(() => departments.id),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    leadUserId: text('lead_user_id').references(() => users.id),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('idx_teams_org').on(table.organizationId),
    deptIdx: index('idx_teams_department').on(table.departmentId),
  }),
);

// ─── Team Members ────────────────────────────────────────────

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: varchar('role', { length: 50 }).default('member'),
    joinedAt: timestamp('joined_at').defaultNow(),
  },
  (table) => ({
    teamUserUnique: uniqueIndex('idx_team_members_unique').on(table.teamId, table.userId),
  }),
);

// ─── Roles ───────────────────────────────────────────────────

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false),
    isActive: boolean('is_active').default(true),
    priority: integer('priority').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('idx_roles_org_slug').on(table.organizationId, table.slug),
  }),
);

// ─── Permissions ─────────────────────────────────────────────

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    module: varchar('module', { length: 100 }).notNull(),
    isSystem: boolean('is_system').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex('idx_permissions_code').on(table.code),
    moduleIdx: index('idx_permissions_module').on(table.module),
  }),
);

// ─── Role Permissions (M:N) ──────────────────────────────────

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    allow: boolean('allow').default(true),
  },
  (table) => ({
    rolePermUnique: uniqueIndex('idx_role_perms_unique').on(table.roleId, table.permissionId),
  }),
);

// ─── User Roles (M:N) ────────────────────────────────────────

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => users.id),
    assignedAt: timestamp('assigned_at').defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    userRoleUnique: uniqueIndex('idx_user_roles_unique').on(table.userId, table.roleId),
  }),
);

// ─── Login History ───────────────────────────────────────────

export const loginHistory = pgTable(
  'login_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    ipAddress: inet('ip_address').notNull(),
    userAgent: text('user_agent'),
    loginMethod: varchar('login_method', { length: 50 }),
    success: boolean('success').default(true),
    failureReason: text('failure_reason'),
    location: jsonb('location'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('idx_login_history_user').on(table.userId, table.createdAt),
  }),
);

// ─── Domain schema files ─────────────────────────────────────

export * from './projects';
export * from './tasks';
export * from './auth';
export * from './audit';
export * from './reports';
export * from './task-templates';
export * from './notifications';
export * from './time-corrections';
export * from './webhooks';
export * from './automation';
export * from './saved-searches';
export * from './leave';
export * from './slack';
export * from './shifts';

// ─── Import domain tables for relations ──────────────────────

import { sessions } from './auth';
import { projects } from './projects';

// ─── Relations ───────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  projects: many(projects),
  departments: many(departments),
  teams: many(teams),
  roles: many(roles),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  department: one(departments, {
    fields: [users.departmentId],
    references: [departments.id],
  }),
  team: one(teams, {
    fields: [users.teamId],
    references: [teams.id],
  }),
  manager: one(users, {
    fields: [users.reportingManagerId],
    references: [users.id],
  }),
  sessions: many(sessions),
  loginHistory: many(loginHistory),
  roles: many(userRoles),
}));
