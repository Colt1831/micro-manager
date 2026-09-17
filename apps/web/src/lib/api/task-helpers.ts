import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ─── URL Parsing ─────────────────────────────────────────────

/**
 * Extract the task ID from a `/api/tasks/[id]/...` URL path.
 * Works for any sub-route under `/api/tasks/:id/`.
 *
 * @example
 *   getTaskIdFromPath('/api/tasks/abc-123/watchers') // => 'abc-123'
 *   getTaskIdFromPath('/api/tasks/abc-123/history')  // => 'abc-123'
 */
export function getTaskIdFromPath(request: Pick<NextRequest, 'nextUrl'>): string {
  const segments = request.nextUrl.pathname.split('/');
  const idIndex = segments.indexOf('tasks');
  return segments[idIndex + 1] ?? '';
}

/**
 * Parse the task ID from a standard `/api/tasks/[id]` URL path (no sub-route).
 * Useful for routes like `/api/tasks/[id]/restore` where the ID is the last segment.
 */
export function getTaskIdFromEndpoint(request: Pick<NextRequest, 'nextUrl'>): string {
  return request.nextUrl.pathname.split('/').pop() ?? '';
}

// ─── Access Check Results ───────────────────────────────────

export interface TaskAccessInfo {
  id: string;
  organizationId: string | null;
  /** Owning department. Required for the wall; absent on legacy callers. */
  departmentId?: string | null;
}

/** The department-scope slice of the auth context (see DeptScope in api-auth). */
export interface TaskAccessScope {
  seeAllDepartments: boolean;
  departmentId: string | null;
}

export interface TaskAccessOptions {
  deletedMessage?: string;
  /**
   * Caller's department scope. Omit only where no wall applies — every
   * `/api/tasks/[id]/*` handler must pass it, or the sub-route becomes a way
   * around the wall enforced on the parent task read.
   */
  scope?: TaskAccessScope;
}

export type TaskAccessError =
  | { code: 'NOT_FOUND'; status: 404; message: string }
  | { code: 'FORBIDDEN'; status: 403; message: string };

export type TaskAccessResult =
  { ok: true; task: TaskAccessInfo } | { ok: false; error: TaskAccessError };

/**
 * Check whether a task exists and belongs to the user's organization.
 * Returns a structured result that can be used to generate error responses.
 *
 * This is a pure logic function — the caller is responsible for providing
 * the task info (from a DB query or a mock).
 */
export function checkTaskAccess(
  task: TaskAccessInfo | undefined,
  orgId: string | null | undefined,
  options?: TaskAccessOptions,
): TaskAccessResult {
  if (!task) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        status: 404,
        message: options?.deletedMessage ?? 'Task not found',
      },
    };
  }

  if (!orgId || task.organizationId !== orgId) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Access denied',
      },
    };
  }

  // Department wall. 404 rather than 403 so a cross-department id is
  // indistinguishable from a missing one — matching /api/tasks/[id] — otherwise
  // the status alone confirms the task exists.
  const scope = options?.scope;
  if (scope && !scope.seeAllDepartments) {
    const taskDept = task.departmentId ?? null;
    if (taskDept == null || taskDept !== scope.departmentId) {
      return {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          status: 404,
          message: options?.deletedMessage ?? 'Task not found',
        },
      };
    }
  }

  return { ok: true, task };
}

/**
 * Convert a `TaskAccessError` into a `NextResponse` JSON error response.
 */
export function accessErrorToResponse(error: TaskAccessError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

/**
 * Convenience: check task access and return a NextResponse if access is denied.
 * Returns `null` if access is allowed, or a `NextResponse` with the error.
 */
export function checkTaskAccessOrRespond(
  task: TaskAccessInfo | undefined,
  orgId: string | null | undefined,
  options?: TaskAccessOptions,
): NextResponse | null {
  const result = checkTaskAccess(task, orgId, options);
  if (!result.ok) {
    return accessErrorToResponse(result.error);
  }
  return null;
}

// ─── Batch Action Helpers ──────────────────────────────────

/**
 * Whether a batch action targets soft-deleted tasks (restore/permanent_delete).
 * Used by the batch endpoint to determine which SQL condition to apply.
 */
export function actionTargetsDeletedTasks(action: string): boolean {
  return action === 'restore' || action === 'permanent_delete';
}
