import { getDb, schema } from '@workmanagement/database';
import { and, eq } from 'drizzle-orm';

// Promote an existing user to the super_admin RANK + role.
//
//   SUPER_ADMIN_EMAIL=owner@example.com DATABASE_URL=... node --import tsx scripts/promote-super-admin.ts
//
// super_admin bypasses the department wall and the downward-assignment ceiling,
// and is the only rank that can grant `owner`. The target is taken from the
// SUPER_ADMIN_EMAIL env only — never hardcoded. Idempotent: re-running is a no-op.

async function promoteSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) {
    console.error('❌ SUPER_ADMIN_EMAIL env var is required (the user to promote to super_admin).');
    process.exit(1);
  }

  const db = getDb();

  const [user] = await db
    .select({
      id: schema.users.id,
      organizationId: schema.users.organizationId,
      rank: schema.users.rank,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) {
    console.error(`❌ No user found with email ${email}. Create the user first (sign up or create-admin).`);
    process.exit(1);
  }

  // Ensure the user belongs to the default org if they don't have one yet.
  let orgId = user.organizationId;
  if (!orgId) {
    const [org] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, 'default'))
      .limit(1);
    if (!org) {
      console.error('❌ No default organization found. Run db:seed first.');
      process.exit(1);
    }
    orgId = org.id;
    await db.update(schema.users).set({ organizationId: orgId }).where(eq(schema.users.id, user.id));
  }

  // ── Set the rank (authority + scope dimension) ──────────
  if (user.rank !== 'super_admin') {
    await db
      .update(schema.users)
      .set({ rank: 'super_admin', updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    console.log(`  ✓ Rank set to super_admin`);
  } else {
    console.log(`  ✓ Rank already super_admin`);
  }

  // ── Assign the super_admin capability role ──────────────
  const [superAdminRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.slug, 'super_admin'), eq(schema.roles.organizationId, orgId)))
    .limit(1);

  if (!superAdminRole) {
    console.error('❌ No super_admin role found for the organization. Run db:seed first.');
    process.exit(1);
  }

  await db
    .insert(schema.userRoles)
    .values({ userId: user.id, roleId: superAdminRole.id })
    .onConflictDoNothing();

  console.log(`✅ Promoted ${email} to super_admin (rank + role).`);
  process.exit(0);
}

promoteSuperAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
