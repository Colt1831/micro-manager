import { getDb, schema } from '@workmanagement/database';
import { eq, and, inArray, isNull, or, gt } from 'drizzle-orm';
import { AsyncLocalStorage } from 'async_hooks';

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
}

// ── Request-scoped permission cache via AsyncLocalStorage ──────────────────
// Each API request gets its own Map<string, Permission[]> so that multiple
// requirePermission() calls within the same request share the 3-query result.
// The store is automatically garbage collected when the request completes.
//
// Design choices:
//   - AsyncLocalStorage ensures zero memory leak between requests
//   - No TTL needed — the cache lives exactly as long as the request
//   - Falls through to DB query if called outside a withAuth context
//     (e.g., from a server component or background job)
// How it works:
//   1. withAuth() creates a new Map and runs the handler inside
//      permissionStorage.run(new Map(), ...)
//   2. getUserPermissions() checks the request-scoped store first
//   3. On cache miss, fetches from DB and populates the store
//   4. When the request completes, the Map is garbage collected
export const permissionStorage = new AsyncLocalStorage<Map<string, Permission[]>>();

/**
 * Get all permissions for a user by looking up their roles and role-permissions.
 * Results are cached per userId within the current request's AsyncLocalStorage
 * context (if one exists), eliminating redundant DB queries.
 */
export async function getUserPermissions(userId: string): Promise<Permission[]> {
  // Check the request-scoped store first
  const store = permissionStorage.getStore();
  if (store) {
    const cached = store.get(userId);
    if (cached) return cached;
  }

  try {
    const db = getDb();

    // Get user's roles — only ACTIVE, non-deleted, non-expired assignments.
    // A deleted/disabled role, or an expired user_role, grants nothing.
    const now = new Date();
    const userRoles = await db
      .select({
        roleId: schema.userRoles.roleId,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(
        and(
          eq(schema.userRoles.userId, userId),
          eq(schema.roles.isActive, true),
          isNull(schema.roles.deletedAt),
          or(isNull(schema.userRoles.expiresAt), gt(schema.userRoles.expiresAt, now)),
        ),
      );

    if (userRoles.length === 0) {
      // Cache empty result to avoid re-querying
      store?.set(userId, []);
      return [];
    }

    const roleIds = userRoles.map((r) => r.roleId);

    // Get every role_permission row for those roles, INCLUDING allow=false.
    // We must see denies to apply deny-override below.
    const rolePerms = await db
      .select({
        permissionId: schema.rolePermissions.permissionId,
        allow: schema.rolePermissions.allow,
      })
      .from(schema.rolePermissions)
      .where(inArray(schema.rolePermissions.roleId, roleIds));

    if (rolePerms.length === 0) {
      store?.set(userId, []);
      return [];
    }

    // Deny-override: a permission is granted only if at least one role allows it
    // AND no role explicitly denies it (allow=false wins across roles).
    const denied = new Set<string>();
    const allowed = new Set<string>();
    for (const rp of rolePerms) {
      if (rp.allow === false) denied.add(rp.permissionId);
      else allowed.add(rp.permissionId);
    }
    const grantedIds = [...allowed].filter((id) => !denied.has(id));

    if (grantedIds.length === 0) {
      store?.set(userId, []);
      return [];
    }

    // Get permission details
    const permissions = await db
      .select({
        id: schema.permissions.id,
        code: schema.permissions.code,
        name: schema.permissions.name,
        module: schema.permissions.module,
      })
      .from(schema.permissions)
      .where(inArray(schema.permissions.id, grantedIds));

    // Populate the request-scoped store before returning
    store?.set(userId, permissions);
    return permissions;
  } catch (error) {
    console.error('Failed to get user permissions:', error);
    return [];
  }
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(userId: string, permissionCode: string): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return permissions.some((p) => p.code === permissionCode);
}

