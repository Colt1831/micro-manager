import { getDb, schema } from './index';
import { eq, inArray } from 'drizzle-orm';

/**
 * Seed the database with default data.
 * Idempotent — safe to run multiple times.
 */
async function seed() {
  const db = getDb();
  console.log('🌱 Seeding database...');

  // ─── Organization ────────────────────────────────────────
  let orgId: string;

  const [existingOrg] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, 'default'))
    .limit(1);

  if (existingOrg) {
    orgId = existingOrg.id;
    console.log(`  ✓ Organization already exists: default`);
  } else {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Default Organization', slug: 'default', isActive: true })
      .returning();
    orgId = org!.id;
    console.log(`  ✓ Organization created: ${org!.name}`);
  }

  // ─── Permissions ─────────────────────────────────────────
  const allPermissions = [
    // User permissions
    { code: 'user:view', name: 'View Users', module: 'user' },
    { code: 'user:create', name: 'Create Users', module: 'user' },
    { code: 'user:edit', name: 'Edit Users', module: 'user' },
    { code: 'user:delete', name: 'Delete Users', module: 'user' },
    { code: 'user:deactivate', name: 'Deactivate Users', module: 'user' },
    { code: 'user:suspend', name: 'Suspend Users', module: 'user' },
    { code: 'user:manage', name: 'Manage Users', module: 'user' },
    // Role permissions
    { code: 'role:view', name: 'View Roles', module: 'role' },
    { code: 'role:create', name: 'Create Roles', module: 'role' },
    { code: 'role:edit', name: 'Edit Roles', module: 'role' },
    { code: 'role:delete', name: 'Delete Roles', module: 'role' },
    { code: 'permission:manage', name: 'Manage Permissions', module: 'role' },
    // Department/team permissions
    { code: 'department:view', name: 'View Departments', module: 'department' },
    { code: 'department:create', name: 'Create Departments', module: 'department' },
    { code: 'department:edit', name: 'Edit Departments', module: 'department' },
    { code: 'department:delete', name: 'Delete Departments', module: 'department' },
    { code: 'team:view', name: 'View Teams', module: 'team' },
    { code: 'team:create', name: 'Create Teams', module: 'team' },
    { code: 'team:edit', name: 'Edit Teams', module: 'team' },
    { code: 'team:delete', name: 'Delete Teams', module: 'team' },
    // Project permissions
    { code: 'project:view', name: 'View Projects', module: 'project' },
    { code: 'project:create', name: 'Create Projects', module: 'project' },
    { code: 'project:edit', name: 'Edit Projects', module: 'project' },
    { code: 'project:delete', name: 'Delete Projects', module: 'project' },
    { code: 'project:archive', name: 'Archive Projects', module: 'project' },
    // Task permissions
    { code: 'task:view', name: 'View Tasks', module: 'task' },
    // Org-wide task visibility (GM+). The tasks route checks this to decide
    // scope; without it seeded, no one could ever see all tasks — a real bug.
    { code: 'task:view_all', name: 'View All Tasks', module: 'task' },
    { code: 'task:create', name: 'Create Tasks', module: 'task' },
    { code: 'task:edit', name: 'Edit Tasks', module: 'task' },
    { code: 'task:delete', name: 'Delete Tasks', module: 'task' },
    { code: 'task:assign', name: 'Assign Tasks', module: 'task' },
    { code: 'task:comment', name: 'Comment on Tasks', module: 'task' },
    { code: 'task:change_status', name: 'Change Task Status', module: 'task' },
    { code: 'task:complete', name: 'Complete Tasks', module: 'task' },
    { code: 'task:review', name: 'Review Tasks', module: 'task' },
    { code: 'task:close', name: 'Close Tasks', module: 'task' },
    { code: 'task:reopen', name: 'Reopen Tasks', module: 'task' },
    { code: 'task:archive', name: 'Archive Tasks', module: 'task' },
    // Task template permissions
    { code: 'task_template:view', name: 'View Task Templates', module: 'task' },
    { code: 'task_template:create', name: 'Create Task Templates', module: 'task' },
    { code: 'task_template:edit', name: 'Edit Task Templates', module: 'task' },
    { code: 'task_template:delete', name: 'Delete Task Templates', module: 'task' },
    // Time tracking permissions
    { code: 'time:manage', name: 'Manage Time Corrections', module: 'time' },

    // Report permissions
    { code: 'report:view', name: 'View Reports', module: 'report' },
    { code: 'report:generate', name: 'Generate Reports', module: 'report' },
    { code: 'report:export', name: 'Export Reports', module: 'report' },
    // Settings permissions
    { code: 'setting:view', name: 'View Settings', module: 'setting' },
    { code: 'setting:edit', name: 'Edit Settings', module: 'setting' },
    // Audit permissions
    { code: 'audit:view', name: 'View Audit Logs', module: 'audit' },
    // Organization permissions
    { code: 'org:view', name: 'View Organization', module: 'org' },
    { code: 'org:edit', name: 'Edit Organization', module: 'org' },
    { code: 'org:settings', name: 'Manage Organization Settings', module: 'org' },
    // Milestone permissions
    { code: 'milestone:view', name: 'View Milestones', module: 'milestone' },
    { code: 'milestone:create', name: 'Create Milestones', module: 'milestone' },
    { code: 'milestone:edit', name: 'Edit Milestones', module: 'milestone' },
    { code: 'milestone:delete', name: 'Delete Milestones', module: 'milestone' },
    // Integration (webhooks) permissions
    { code: 'integration:view', name: 'View Integrations', module: 'integration' },
    { code: 'integration:create', name: 'Create Integrations', module: 'integration' },
    { code: 'integration:edit', name: 'Edit Integrations', module: 'integration' },
    { code: 'integration:delete', name: 'Delete Integrations', module: 'integration' },
    // Settings (plural codes used by settings/ai + automation routes)
    { code: 'settings:view', name: 'View Settings', module: 'settings' },
    { code: 'settings:manage', name: 'Manage Settings', module: 'settings' },
    // Role assignment
    { code: 'role:assign', name: 'Assign Roles', module: 'role' },
    // Report snapshot creation
    { code: 'report:create', name: 'Create Report Snapshots', module: 'report' },
    // Team member management
    { code: 'team:manage', name: 'Manage Team Members', module: 'team' },
  ];

  // Insert permissions that don't exist yet
  const existingPerms = await db.select({ code: schema.permissions.code }).from(schema.permissions);

  const existingCodes = new Set(existingPerms.map((p) => p.code));
  const newPerms = allPermissions.filter((p) => !existingCodes.has(p.code));

  if (newPerms.length > 0) {
    await db.insert(schema.permissions).values(newPerms.map((p) => ({ ...p, isSystem: true })));
  }

  // Fetch all permissions to get their IDs
  const allPermRecords = await db
    .select()
    .from(schema.permissions)
    .where(
      inArray(
        schema.permissions.code,
        allPermissions.map((p) => p.code),
      ),
    );

  const permByCode = new Map(allPermRecords.map((p) => [p.code, p]));
  console.log(`  ✓ ${allPermRecords.length} permissions available`);

  // ─── Roles ───────────────────────────────────────────────

  // Helper to create or get a role
  async function ensureRole(data: {
    slug: string;
    name: string;
    description: string;
    priority: number;
    permissionCodes: string[];
  }) {
    const [existing] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.slug, data.slug))
      .limit(1);

    let role = existing;
    if (!role) {
      [role] = await db
        .insert(schema.roles)
        .values({
          organizationId: orgId,
          name: data.name,
          slug: data.slug,
          description: data.description,
          isSystem: true,
          priority: data.priority,
        })
        .returning();
    } else if (
      role.priority !== data.priority ||
      role.name !== data.name ||
      role.description !== data.description
    ) {
      // Converge system-role metadata on re-seed. priority is security-relevant:
      // the role-assignment grant ceiling ranks roles by priority, so a stale
      // value (e.g. legacy manager=80) is a privilege-escalation risk. Idempotent
      // — the UPDATE only runs when something actually differs.
      [role] = await db
        .update(schema.roles)
        .set({
          name: data.name,
          description: data.description,
          priority: data.priority,
          updatedAt: new Date(),
        })
        .where(eq(schema.roles.id, role.id))
        .returning();
    }

    // Assign permissions that aren't already assigned
    const existingRolePerms = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role!.id));

    const existingPermIds = new Set(existingRolePerms.map((rp) => rp.permissionId));
    const newRolePerms = data.permissionCodes
      .map((code) => permByCode.get(code))
      .filter((p): p is NonNullable<typeof p> => p != null && !existingPermIds.has(p.id))
      .map((p) => ({ roleId: role!.id, permissionId: p.id, allow: true }));

    if (newRolePerms.length > 0) {
      await db.insert(schema.rolePermissions).values(newRolePerms);
    }

    return role!;
  }

  const allCodes = allPermissions.map((p) => p.code);

  await ensureRole({
    slug: 'admin',
    name: 'Administrator',
    description: 'Full system access',
    priority: 100,
    permissionCodes: allCodes,
  });
  console.log('  ✓ Role: Administrator');

  // ─── System RANK roles ───────────────────────────────────
  // Capability bundles that back the org rank hierarchy. priority == rank level
  // (packages/shared/src/constants/rank.ts) so the grant ceiling in
  // /api/users/[id]/roles enforces downward-only assignment. task:view_all is
  // granted to general_manager and up only.

  await ensureRole({
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Platform super administrator — full access, all departments',
    priority: 100,
    permissionCodes: allCodes,
  });
  console.log('  ✓ Role: Super Admin');

  await ensureRole({
    slug: 'owner',
    name: 'Owner',
    description: 'Organization owner — full organizational access',
    priority: 60,
    permissionCodes: allCodes,
  });
  console.log('  ✓ Role: Owner');

  await ensureRole({
    slug: 'general_manager',
    name: 'General Manager',
    description: 'Cross-department management; org-wide task visibility',
    priority: 50,
    permissionCodes: [
      'user:view',
      'user:create',
      'user:edit',
      'role:view',
      'role:assign',
      'department:view',
      'department:create',
      'department:edit',
      'team:view',
      'team:create',
      'team:edit',
      'team:manage',
      'project:view',
      'project:create',
      'project:edit',
      'project:archive',
      'task:view',
      'task:view_all',
      'task:create',
      'task:edit',
      'task:assign',
      'task:comment',
      'task:change_status',
      'task:complete',
      'task:review',
      'task:close',
      'task:reopen',
      'milestone:view',
      'milestone:create',
      'milestone:edit',
      'report:view',
      'report:generate',
      'report:export',
      'report:create',
      'time:manage',
      'integration:view',
      'setting:view',
      'settings:view',
      'org:view',
      'audit:view',
    ],
  });
  console.log('  ✓ Role: General Manager');

  await ensureRole({
    slug: 'manager',
    name: 'Manager',
    description: 'Department/team management access',
    // Rank level for manager (see packages/shared/src/constants/rank.ts). Was 80;
    // lowered so a manager cannot assign general_manager(50)/owner(60) via the
    // grant ceiling. No task:view_all — org-wide task visibility is GM+ only.
    priority: 40,
    permissionCodes: [
      'user:view',
      'role:view',
      'department:view',
      'department:create',
      'department:edit',
      'team:view',
      'team:create',
      'team:edit',
      'project:view',
      'project:create',
      'project:edit',
      'task:view',
      'task:create',
      'task:edit',
      'task:assign',
      'task:comment',
      'task:change_status',
      'task:complete',
      'task:review',
      'task:close',
      'report:view',
      'report:generate',
      'report:export',
      'time:manage',
      'setting:view',
      'settings:view',
      'report:create',
      'team:manage',
      'role:assign',
      'milestone:view',
    ],
  });
  console.log('  ✓ Role: Manager');

  await ensureRole({
    slug: 'team_lead',
    name: 'Team Lead',
    description: 'Team-level task management access',
    // Rank level for team_lead (see rank.ts). Was 60.
    priority: 30,
    permissionCodes: [
      'user:view',
      'team:view',
      'project:view',
      'task:view',
      'task:create',
      'task:edit',
      'task:assign',
      'task:comment',
      'task:change_status',
      'task:complete',
      'task:review',
      'report:view',
      'milestone:view',
    ],
  });
  console.log('  ✓ Role: Team Lead');

  await ensureRole({
    slug: 'member',
    name: 'Member',
    description: 'Standard team member',
    priority: 40,
    permissionCodes: [
      'user:view',
      'team:view',
      'project:view',
      'task:view',
      'task:create',
      'task:edit',
      'task:comment',
      'task:change_status',
      'task:complete',
      'report:view',
      'milestone:view',
    ],
  });
  console.log('  ✓ Role: Member');

  await ensureRole({
    slug: 'viewer',
    name: 'Viewer',
    description: 'Read-only access',
    priority: 20,
    permissionCodes: ['user:view', 'team:view', 'project:view', 'task:view', 'report:view', 'milestone:view'],
  });
  console.log('  ✓ Role: Viewer');

  await ensureRole({
    slug: 'senior_executive',
    name: 'Senior Executive',
    description: 'Senior individual contributor — task execution + review',
    priority: 20,
    permissionCodes: [
      'user:view',
      'team:view',
      'project:view',
      'task:view',
      'task:create',
      'task:edit',
      'task:comment',
      'task:change_status',
      'task:complete',
      'task:review',
      'report:view',
      'milestone:view',
    ],
  });
  console.log('  ✓ Role: Senior Executive');

  await ensureRole({
    slug: 'executive',
    name: 'Executive',
    description: 'Individual contributor — own task execution',
    priority: 10,
    permissionCodes: [
      'user:view',
      'team:view',
      'project:view',
      'task:view',
      'task:create',
      'task:edit',
      'task:comment',
      'task:change_status',
      'task:complete',
      'report:view',
      'milestone:view',
    ],
  });
  console.log('  ✓ Role: Executive');

  // ─── Department & Team ───────────────────────────────────
  const [existingDept] = await db
    .select()
    .from(schema.departments)
    .where(eq(schema.departments.code, 'ENG'))
    .limit(1);

  let deptId = existingDept?.id;
  if (!deptId) {
    const [dept] = await db
      .insert(schema.departments)
      .values({
        organizationId: orgId,
        name: 'Engineering',
        code: 'ENG',
        description: 'Engineering department',
        isActive: true,
      })
      .returning();
    deptId = dept!.id;
    console.log(`  ✓ Department: Engineering`);
  }

  const [existingTeam] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.code, 'CORE'))
    .limit(1);

  if (!existingTeam) {
    await db
      .insert(schema.teams)
      .values({
        organizationId: orgId,
        departmentId: deptId,
        name: 'Core Platform',
        code: 'CORE',
        description: 'Core platform team',
        isActive: true,
      })
      .returning();
    console.log('  ✓ Team: Core Platform');
  }

  console.log('\n✅ Seed complete!');
  console.log(
    '   Roles: super_admin, admin, owner, general_manager, manager, team_lead, senior_executive, member, viewer, executive',
  );
  console.log(`   ${allPermRecords.length} permissions`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
