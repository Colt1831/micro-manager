import { db, schema } from '@/lib/api/db';
import { eq } from 'drizzle-orm';
import { isSuperAdmin, outranks } from '@workmanagement/shared';
import type { DeptScope } from '@/lib/auth/api-auth';

/**
 * A structured assignment denial — code/message/status ready to become an
 * API error response. `null` means the assignment is allowed.
 */
export type AssignmentDenial = { code: string; message: string; status: number };

/**
 * The SINGLE funnel for "may this actor assign a task to this user?" (§4).
 * Task create, single-assign (PATCH assignedTo), and batch-assign all call
 * this so the rule cannot diverge. Enforces, in order:
 *  - assignee exists, same org, active/unsuspended;
 *  - strictly downward: `outranks(actor, assignee)` — Super Admin exempt;
 *  - same department UNLESS the actor sees all departments (GM/Owner/Super Admin).
 *
 * Returns `null` when allowed, or a structured denial the caller renders.
 */
export async function validateAssignment(
  scope: DeptScope,
  assigneeId: string,
  orgId: string | null,
): Promise<AssignmentDenial | null> {
  const [assignee] = await db()
    .select({
      id: schema.users.id,
      organizationId: schema.users.organizationId,
      isActive: schema.users.isActive,
      isSuspended: schema.users.isSuspended,
      rank: schema.users.rank,
      departmentId: schema.users.departmentId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, assigneeId))
    .limit(1);

  if (!assignee) {
    return { code: 'NOT_FOUND', message: 'Assigned user not found', status: 404 };
  }
  if (!orgId || assignee.organizationId !== orgId) {
    return { code: 'FORBIDDEN', message: 'Cross-organization assignment denied', status: 403 };
  }
  if (!assignee.isActive || assignee.isSuspended) {
    return {
      code: 'INVALID_STATE',
      message: 'Cannot assign task to inactive or suspended user',
      status: 422,
    };
  }
  // Downward-only: the actor must strictly outrank the assignee. Super Admin
  // is exempt (may assign to anyone).
  if (!isSuperAdmin(scope.rank) && !outranks(scope.rank, assignee.rank)) {
    return {
      code: 'FORBIDDEN',
      message: 'You can only assign tasks to a user below your own rank',
      status: 403,
    };
  }
  // Department wall: cross-department assignment is allowed only for the ranks
  // that see all departments (GM/Owner/Super Admin).
  if (!scope.seeAllDepartments && assignee.departmentId !== scope.departmentId) {
    return {
      code: 'FORBIDDEN',
      message: 'You can only assign tasks within your own department',
      status: 403,
    };
  }
  return null;
}
