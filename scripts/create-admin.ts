import { getDb, schema } from '@workmanagement/database';
import { eq } from 'drizzle-orm';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Credentials come from the environment — NEVER hardcode them here.
//   ADMIN_EMAIL      (optional; defaults below)
//   ADMIN_PASSWORD   (required; use a fresh random value, e.g.
//                    `openssl rand -base64 18`)
//
// Run against a database with:
//   ADMIN_PASSWORD=... node --import tsx scripts/create-admin.ts
// (set DATABASE_URL to the target database first)

async function createAdmin() {
  const db = getDb();
  console.log('🔧 Creating admin user...');

  const email = process.env.ADMIN_EMAIL ?? 'colt453118@gmail.com';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error(
      '❌ ADMIN_PASSWORD environment variable is required (never commit a default).\n' +
        '   Generate one with: openssl rand -base64 18\n' +
        '   Then: ADMIN_PASSWORD=... DATABASE_URL=... node --import tsx scripts/create-admin.ts',
    );
    process.exit(1);
  }

  // ─── Check if user already exists ──────────────────────
  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existingUser) {
    console.log(`  ✓ Admin user already exists (id: ${existingUser.id})`);
    console.log('  (use scripts/fix-password.ts with ADMIN_PASSWORD to rotate its password)');
    return;
  }

  // ─── Get default organization ──────────────────────────
  const [org] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, 'default'))
    .limit(1);

  if (!org) {
    console.error('❌ No default organization found. Run db:seed first.');
    process.exit(1);
  }

  // ─── Get admin role ────────────────────────────────────
  // The bootstrap admin is the org's first account and must hold real
  // authority: super_admin RANK (bypasses the department wall) AND the
  // super_admin capability role. The plain 'admin' role alone left this
  // user at the default 'executive' rank — powerless in a ranked org.
  const [adminRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, 'super_admin'))
    .limit(1);

  if (!adminRole) {
    console.error('❌ No super_admin role found. Run db:seed first.');
    process.exit(1);
  }

  const userId = crypto.randomUUID();

  // Hash using scrypt with same parameters as better-auth v1.6.23
  const salt = randomBytes(16).toString('hex');
  const hashBuf = (await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  const passwordHash = `${salt}:${hashBuf.toString('hex')}`;

  console.log(`  ✓ Password hashed with scrypt (never printed)`);

  // ─── Create user ────────────────────────────────────────
  await db.insert(schema.users).values({
    id: userId,
    email,
    name: 'Admin User',
    firstName: 'Admin',
    lastName: 'User',
    displayName: 'Admin User',
    emailVerified: true,
    organizationId: org.id,
    isActive: true,
    isSuspended: false,
    rank: 'super_admin',
  });
  console.log(`  ✓ User created: ${email} (id: ${userId})`);

  // ─── Create account (for email/password login) ─────────
  await db.insert(schema.accounts).values({
    id: crypto.randomUUID(),
    userId,
    accountId: email,
    providerId: 'credential',
    password: passwordHash,
  });
  console.log(`  ✓ Account created for email/password login`);

  // ─── Assign admin role ─────────────────────────────────
  await db.insert(schema.userRoles).values({
    id: crypto.randomUUID(),
    userId,
    roleId: adminRole.id,
  });
  console.log(`  ✓ Admin role assigned`);
  console.log(`\n✅ Admin user created successfully!`);
  console.log(`   Email:    ${email}`);
  console.log(`   (set ADMIN_PASSWORD to a new random value for each environment)`);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  console.log(`   URL:      ${appUrl}/auth/login`);

  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('❌ Failed to create admin user:', err);
  process.exit(1);
});
