/**
 * Demo seed — a believable org so every dashboard page has content.
 *
 * Idempotent: keyed on stable demo emails / codes. Safe to re-run.
 * Dev/preview only. Requires the base seed first (org, roles, permissions).
 *
 * Usage:
 *   DATABASE_URL="postgres://dev:devpassword@localhost:5432/workmanagement" \
 *     pnpm --filter @workmanagement/database exec tsx scripts/seed-demo.ts
 */
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../src/index';

const scryptAsync = promisify(scrypt);

/** Same scrypt parameters as better-auth v1.6.23 (mirrors scripts/create-admin.ts). */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await (scryptAsync as (
    pw: string,
    salt: string,
    len: number,
    opts: { N: number; r: number; p: number; maxmem: number },
  ) => Promise<Buffer>)(password, salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }));
  return `${salt}:${buf.toString('hex')}`;
}

const DEMO_PASSWORD = 'DemoPass123!';

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Engineering department' },
  { name: 'Sales', code: 'SLS', description: 'Sales and revenue' },
  { name: 'Operations', code: 'OPS', description: 'Business operations' },
];

/** Reporting lines point UP the ladder; `manager` is an email in this same list. */
const PEOPLE = [
  { email: 'gm@demo.local', first: 'Grace', last: 'Moore', rank: 'general_manager', dept: 'ENG', role: 'general_manager', manager: null, designation: 'General Manager' },
  { email: 'mgr.eng@demo.local', first: 'Marcus', last: 'Ellis', rank: 'manager', dept: 'ENG', role: 'manager', manager: 'gm@demo.local', designation: 'Engineering Manager' },
  { email: 'lead.eng@demo.local', first: 'Lena', last: 'Diaz', rank: 'team_lead', dept: 'ENG', role: 'team_lead', manager: 'mgr.eng@demo.local', designation: 'Tech Lead' },
  { email: 'dev1@demo.local', first: 'Dan', last: 'Ito', rank: 'executive', dept: 'ENG', role: 'executive', manager: 'lead.eng@demo.local', designation: 'Software Engineer' },
  { email: 'dev2@demo.local', first: 'Dana', last: 'Roy', rank: 'senior_executive', dept: 'ENG', role: 'senior_executive', manager: 'lead.eng@demo.local', designation: 'Senior Engineer' },
  { email: 'mgr.sales@demo.local', first: 'Sam', last: 'Patel', rank: 'manager', dept: 'SLS', role: 'manager', manager: 'gm@demo.local', designation: 'Sales Manager' },
  { email: 'rep1@demo.local', first: 'Rita', last: 'Chen', rank: 'executive', dept: 'SLS', role: 'executive', manager: 'mgr.sales@demo.local', designation: 'Account Executive' },
  { email: 'ops1@demo.local', first: 'Omar', last: 'Naz', rank: 'executive', dept: 'OPS', role: 'executive', manager: 'gm@demo.local', designation: 'Operations Analyst' },
];

const PROJECTS = [
  { key: 'PLAT', name: 'Platform Rebuild', dept: 'ENG', owner: 'mgr.eng@demo.local', description: 'Re-architect the core platform services.' },
  { key: 'PIPE', name: 'Q4 Pipeline', dept: 'SLS', owner: 'mgr.sales@demo.local', description: 'Close the Q4 enterprise pipeline.' },
  { key: 'VEND', name: 'Vendor Migration', dept: 'OPS', owner: 'ops1@demo.local', description: 'Migrate vendors to the new procurement flow.' },
];

/**
 * Tasks per project. `due` is an offset in days from today so Calendar,
 * Gantt and the Overdue KPI all populate. Statuses span the lifecycle.
 * `assignee` MUST be in the project's department — the department wall
 * hides cross-department rows and the pages would look empty again.
 */
const TASK_PLAN: Record<string, Array<{ title: string; status: string; priority: string; due: number; assignee: string }>> = {
  PLAT: [
    { title: 'Split the monolith auth module', status: 'in_progress', priority: 'high', due: 3, assignee: 'dev1@demo.local' },
    { title: 'Add read replica failover', status: 'open', priority: 'medium', due: 10, assignee: 'dev2@demo.local' },
    { title: 'Migrate job queue to workers', status: 'blocked', priority: 'urgent', due: -2, assignee: 'dev1@demo.local' },
    { title: 'Instrument request tracing', status: 'under_review', priority: 'medium', due: 6, assignee: 'dev2@demo.local' },
    { title: 'Retire legacy session store', status: 'completed', priority: 'low', due: -9, assignee: 'lead.eng@demo.local' },
    { title: 'Harden rate limiting', status: 'assigned', priority: 'high', due: 14, assignee: 'dev2@demo.local' },
    { title: 'Draft rollout runbook', status: 'draft', priority: 'low', due: 21, assignee: 'lead.eng@demo.local' },
    { title: 'Patch dependency CVEs', status: 'on_hold', priority: 'critical', due: -5, assignee: 'dev1@demo.local' },
  ],
  PIPE: [
    { title: 'Qualify inbound enterprise leads', status: 'in_progress', priority: 'high', due: 2, assignee: 'rep1@demo.local' },
    { title: 'Prepare Q4 renewal deck', status: 'open', priority: 'medium', due: 8, assignee: 'rep1@demo.local' },
    { title: 'Follow up stalled accounts', status: 'blocked', priority: 'high', due: -3, assignee: 'rep1@demo.local' },
    { title: 'Negotiate the Northwind contract', status: 'under_review', priority: 'urgent', due: 5, assignee: 'mgr.sales@demo.local' },
    { title: 'Close Q3 commission reconciliation', status: 'completed', priority: 'medium', due: -12, assignee: 'mgr.sales@demo.local' },
    { title: 'Refresh pricing one-pager', status: 'draft', priority: 'low', due: 18, assignee: 'rep1@demo.local' },
  ],
  VEND: [
    { title: 'Audit active vendor contracts', status: 'in_progress', priority: 'medium', due: 4, assignee: 'ops1@demo.local' },
    { title: 'Migrate procurement approvals', status: 'open', priority: 'high', due: 12, assignee: 'ops1@demo.local' },
    { title: 'Escalate overdue invoices', status: 'blocked', priority: 'urgent', due: -6, assignee: 'ops1@demo.local' },
    { title: 'Archive terminated vendor records', status: 'completed', priority: 'low', due: -15, assignee: 'ops1@demo.local' },
    { title: 'Document the new intake process', status: 'draft', priority: 'low', due: 20, assignee: 'ops1@demo.local' },
  ],
};

/** timestamp() columns take a Date. */
function daysFromNow(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** date() columns take a 'YYYY-MM-DD' string, not a Date. */
function dateStr(offset: number): string {
  return daysFromNow(offset).toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const db = getDb();
  console.log('🌱 Seeding demo data...');

  // ─── Reuse the org the base seed created ────────────────
  const [org] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, 'default'))
    .limit(1);
  if (!org) throw new Error('No org. Run: pnpm --filter @workmanagement/database db:seed');
  const orgId = org.id;

  // ─── Departments ─────────────────────────────────────────
  const deptIdByCode = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const [existing] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(and(eq(schema.departments.organizationId, orgId), eq(schema.departments.code, d.code)))
      .limit(1);
    if (existing) {
      deptIdByCode.set(d.code, existing.id);
      continue;
    }
    const [created] = await db
      .insert(schema.departments)
      .values({ organizationId: orgId, name: d.name, code: d.code, description: d.description, isActive: true })
      .returning({ id: schema.departments.id });
    deptIdByCode.set(d.code, created!.id);
    console.log(`  ✓ Department: ${d.name}`);
  }

  // ─── Users (two passes: create, then wire reporting lines) ──
  const roleIdBySlug = new Map<string, string>();
  for (const slug of new Set(PEOPLE.map((p) => p.role))) {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.slug, slug))
      .limit(1);
    if (role) roleIdBySlug.set(slug, role.id);
  }

  const userIdByEmail = new Map<string, string>();
  for (const p of PEOPLE) {
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, p.email))
      .limit(1);
    if (existing) {
      userIdByEmail.set(p.email, existing.id);
      continue;
    }
    const userId = crypto.randomUUID();
    const name = `${p.first} ${p.last}`;
    await db.insert(schema.users).values({
      id: userId,
      email: p.email,
      name,
      firstName: p.first,
      lastName: p.last,
      displayName: name,
      emailVerified: true,
      organizationId: orgId,
      departmentId: deptIdByCode.get(p.dept)!,
      rank: p.rank,
      designation: p.designation,
      isActive: true,
      isSuspended: false,
    });
    await db.insert(schema.accounts).values({
      id: crypto.randomUUID(),
      userId,
      accountId: p.email,
      providerId: 'credential',
      password: await hashPassword(DEMO_PASSWORD),
    });
    const roleId = roleIdBySlug.get(p.role);
    if (roleId) {
      await db.insert(schema.userRoles).values({ id: crypto.randomUUID(), userId, roleId });
    }
    userIdByEmail.set(p.email, userId);
    console.log(`  ✓ User: ${p.email} (${p.rank})`);
  }

  for (const p of PEOPLE) {
    if (!p.manager) continue;
    const userId = userIdByEmail.get(p.email);
    const managerId = userIdByEmail.get(p.manager);
    if (userId && managerId) {
      await db.update(schema.users).set({ reportingManagerId: managerId }).where(eq(schema.users.id, userId));
    }
  }

  // ─── Projects ────────────────────────────────────────────
  const projectIdByKey = new Map<string, string>();
  for (const pr of PROJECTS) {
    const [existing] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.name, pr.name)))
      .limit(1);
    if (existing) {
      projectIdByKey.set(pr.key, existing.id);
      continue;
    }
    const [created] = await db
      .insert(schema.projects)
      .values({
        organizationId: orgId,
        name: pr.name,
        description: pr.description,
        ownerId: userIdByEmail.get(pr.owner)!,
        departmentId: deptIdByCode.get(pr.dept)!,
        status: 'active',
        startDate: dateStr(-30),
        endDate: dateStr(60),
      })
      .returning({ id: schema.projects.id });
    projectIdByKey.set(pr.key, created!.id);
    console.log(`  ✓ Project: ${pr.name}`);
  }

  // ─── Tasks ───────────────────────────────────────────────
  let taskCount = 0;
  const createdTaskIds: string[] = [];
  for (const pr of PROJECTS) {
    const projectId = projectIdByKey.get(pr.key)!;
    const deptId = deptIdByCode.get(pr.dept)!;
    const creatorId = userIdByEmail.get(pr.owner)!;
    for (const [i, t] of TASK_PLAN[pr.key]!.entries()) {
      const displayId = `${pr.key}-${String(i + 1).padStart(3, '0')}`;
      const [existing] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.organizationId, orgId), eq(schema.tasks.taskIdDisplay, displayId)))
        .limit(1);
      if (existing) {
        createdTaskIds.push(existing.id);
        continue;
      }
      const [created] = await db
        .insert(schema.tasks)
        .values({
          organizationId: orgId,
          taskIdDisplay: displayId,
          title: t.title,
          description: `${t.title} — seeded demo task for ${pr.name}.`,
          status: t.status,
          priority: t.priority,
          projectId,
          departmentId: deptId,
          assigneeId: userIdByEmail.get(t.assignee)!,
          createdBy: creatorId,
          dueDate: daysFromNow(t.due),
        })
        .returning({ id: schema.tasks.id });
      createdTaskIds.push(created!.id);
      taskCount++;
    }
  }
  console.log(`  ✓ Tasks: ${taskCount} created`);

  // ─── Comments (so global comment search returns hits) ────
  const COMMENTS = [
    'Blocked on the upstream migration — following up tomorrow.',
    'Pushed the first cut, ready for review.',
    'Confirmed with the vendor, we are good to proceed.',
  ];
  for (const [i, body] of COMMENTS.entries()) {
    const taskId = createdTaskIds[i];
    if (!taskId) break;
    const [existing] = await db
      .select({ id: schema.taskComments.id })
      .from(schema.taskComments)
      .where(and(eq(schema.taskComments.taskId, taskId), eq(schema.taskComments.content, body)))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.taskComments).values({
      taskId,
      userId: userIdByEmail.get(PEOPLE[i % PEOPLE.length]!.email)!,
      content: body,
    });
  }
  console.log('  ✓ Comments seeded');

  // ─── Leave requests (Calendar overlay + Leave pages) ─────
  const [vacation] = await db
    .select({ id: schema.leaveTypes.id })
    .from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.organizationId, orgId), eq(schema.leaveTypes.slug, 'vacation')))
    .limit(1);

  if (vacation) {
    const LEAVES = [
      { user: 'dev1@demo.local', from: 2, to: 4, status: 'approved', reason: 'Family holiday' },
      { user: 'rep1@demo.local', from: 9, to: 10, status: 'approved', reason: 'Long weekend' },
      { user: 'dev2@demo.local', from: 15, to: 16, status: 'pending', reason: 'Personal time' },
    ];
    for (const lv of LEAVES) {
      const userId = userIdByEmail.get(lv.user)!;
      const startDate = dateStr(lv.from);
      const [existing] = await db
        .select({ id: schema.leaveRequests.id })
        .from(schema.leaveRequests)
        .where(and(eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.reason, lv.reason)))
        .limit(1);
      if (existing) continue;
      await db.insert(schema.leaveRequests).values({
        organizationId: orgId,
        userId,
        leaveTypeId: vacation.id,
        startDate,
        endDate: dateStr(lv.to),
        daysCount: lv.to - lv.from + 1,
        status: lv.status,
        reason: lv.reason,
      });
    }
    console.log('  ✓ Leave requests seeded');
  }

  console.log('✓ demo seed complete');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
