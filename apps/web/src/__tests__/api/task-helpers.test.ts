import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  getTaskIdFromPath,
  getTaskIdFromEndpoint,
  checkTaskAccess,
  checkTaskAccessOrRespond,
  accessErrorToResponse,
  actionTargetsDeletedTasks,
} from '@/lib/api/task-helpers';
import type { TaskAccessInfo } from '@/lib/api/task-helpers';

// ─── Helpers ────────────────────────────────────────────────

/** Create a minimal mock NextRequest with a given pathname */
function mockRequest(pathname: string): Pick<NextRequest, 'nextUrl'> {
  return { nextUrl: { pathname } } as Pick<NextRequest, 'nextUrl'>;
}

const validTask: TaskAccessInfo = {
  id: 'task-123',
  organizationId: 'org-1',
};

// ─── getTaskIdFromPath ───────────────────────────────────────

describe('getTaskIdFromPath', () => {
  it('extracts task ID from /api/tasks/{id}/watchers', () => {
    const req = mockRequest('/api/tasks/abc-123/watchers');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/history', () => {
    const req = mockRequest('/api/tasks/abc-123/history');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/comments', () => {
    const req = mockRequest('/api/tasks/abc-123/comments');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/attachments', () => {
    const req = mockRequest('/api/tasks/abc-123/attachments');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/dependencies', () => {
    const req = mockRequest('/api/tasks/abc-123/dependencies');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/time-entries', () => {
    const req = mockRequest('/api/tasks/abc-123/time-entries');
    expect(getTaskIdFromPath(req)).toBe('abc-123');
  });

  it('handles UUID-style task IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const req = mockRequest(`/api/tasks/${uuid}/watchers`);
    expect(getTaskIdFromPath(req)).toBe(uuid);
  });

  it('returns empty string when tasks segment is not found', () => {
    const req = mockRequest('/api/users/abc-123');
    expect(getTaskIdFromPath(req)).toBe('');
  });

  it('returns empty string for root path', () => {
    const req = mockRequest('/');
    expect(getTaskIdFromPath(req)).toBe('');
  });

  it('handles empty pathname', () => {
    const req = mockRequest('');
    expect(getTaskIdFromPath(req)).toBe('');
  });
});

// ─── getTaskIdFromEndpoint ───────────────────────────────────

describe('getTaskIdFromEndpoint', () => {
  it('extracts task ID from /api/tasks/{id}', () => {
    const req = mockRequest('/api/tasks/abc-123');
    expect(getTaskIdFromEndpoint(req)).toBe('abc-123');
  });

  it('extracts task ID from /api/tasks/{id}/restore', () => {
    const req = mockRequest('/api/tasks/abc-123/restore');
    expect(getTaskIdFromEndpoint(req)).toBe('restore');
    // Note: for sub-routes like /restore, use getTaskIdFromPath instead
  });

  it('handles UUID in simple endpoint', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const req = mockRequest(`/api/tasks/${uuid}`);
    expect(getTaskIdFromEndpoint(req)).toBe(uuid);
  });

  it('returns empty string for root path', () => {
    const req = mockRequest('/');
    expect(getTaskIdFromEndpoint(req)).toBe('');
  });
});

// ─── checkTaskAccess ───────────────────────────────────────

describe('checkTaskAccess', () => {
  it('returns ok when task exists and belongs to org', () => {
    const result = checkTaskAccess(validTask, 'org-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task).toBe(validTask);
    }
  });

  it('returns NOT_FOUND when task is undefined', () => {
    const result = checkTaskAccess(undefined, 'org-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.status).toBe(404);
      expect(result.error.message).toBe('Task not found');
    }
  });

  it('returns NOT_FOUND with custom message when provided', () => {
    const result = checkTaskAccess(undefined, 'org-1', {
      deletedMessage: 'Deleted task not found',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Deleted task not found');
    }
  });

  it('returns FORBIDDEN when task belongs to a different org', () => {
    const result = checkTaskAccess(validTask, 'org-2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
      expect(result.error.status).toBe(403);
      expect(result.error.message).toBe('Access denied');
    }
  });

  it('returns ok when both orgs match (same string)', () => {
    const task = { id: 'task-456', organizationId: 'my-org' };
    const result = checkTaskAccess(task, 'my-org');
    expect(result.ok).toBe(true);
  });
});

// ─── accessErrorToResponse ─────────────────────────────────

describe('accessErrorToResponse', () => {
  it('returns a 404 NextResponse for NOT_FOUND', () => {
    const response = accessErrorToResponse({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Not found',
    });
    expect(response.status).toBe(404);
  });

  it('returns a 403 NextResponse for FORBIDDEN', () => {
    const response = accessErrorToResponse({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Access denied',
    });
    expect(response.status).toBe(403);
  });
});

// ─── checkTaskAccessOrRespond ─────────────────────────────

describe('checkTaskAccessOrRespond', () => {
  it('returns null when access is allowed', () => {
    const result = checkTaskAccessOrRespond(validTask, 'org-1');
    expect(result).toBeNull();
  });

  it('returns 404 response when task is undefined', () => {
    const result = checkTaskAccessOrRespond(undefined, 'org-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(404);
  });

  it('returns 403 response when task belongs to another org', () => {
    const result = checkTaskAccessOrRespond(validTask, 'org-2');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('passes custom deletedMessage to the underlying check', () => {
    const result = checkTaskAccessOrRespond(undefined, 'org-1', {
      deletedMessage: 'Custom not found',
    });
    expect(result).not.toBeNull();
  });
});

// ─── actionTargetsDeletedTasks ──────────────────────────────

describe('actionTargetsDeletedTasks', () => {
  it('returns true for restore', () => {
    expect(actionTargetsDeletedTasks('restore')).toBe(true);
  });

  it('returns true for permanent_delete', () => {
    expect(actionTargetsDeletedTasks('permanent_delete')).toBe(true);
  });

  it('returns false for change_status', () => {
    expect(actionTargetsDeletedTasks('change_status')).toBe(false);
  });

  it('returns false for change_priority', () => {
    expect(actionTargetsDeletedTasks('change_priority')).toBe(false);
  });

  it('returns false for assign', () => {
    expect(actionTargetsDeletedTasks('assign')).toBe(false);
  });

  it('returns false for delete', () => {
    expect(actionTargetsDeletedTasks('delete')).toBe(false);
  });

  it('returns false for unknown action', () => {
    expect(actionTargetsDeletedTasks('unknown')).toBe(false);
  });
});

// ─── Integration-style: checkTaskAccess + accessErrorToResponse ────

describe('Task access check integration', () => {
  it('full flow: allowed task produces no error response and access result is ok', () => {
    const accessResult = checkTaskAccess(validTask, 'org-1');
    expect(accessResult.ok).toBe(true);

    // Simulate route handler: accessErrorToResponse is not called when ok
  });

  it('full flow: forbidden task produces 403 response', () => {
    const accessResult = checkTaskAccess(validTask, 'org-2');
    expect(accessResult.ok).toBe(false);

    if (!accessResult.ok) {
      const response = accessErrorToResponse(accessResult.error);
      expect(response.status).toBe(403);
    }
  });

  it('full flow: not-found task produces 404 response', () => {
    const accessResult = checkTaskAccess(undefined, 'org-1');
    expect(accessResult.ok).toBe(false);

    if (!accessResult.ok) {
      const response = accessErrorToResponse(accessResult.error);
      expect(response.status).toBe(404);
    }
  });

  it('checkTaskAccessOrRespond combines check + response in one call', () => {
    // This is what the actual route handlers use
    expect(checkTaskAccessOrRespond(validTask, 'org-1')).toBeNull();
    expect(checkTaskAccessOrRespond(undefined, 'org-1')?.status).toBe(404);
    expect(checkTaskAccessOrRespond(validTask, 'org-2')?.status).toBe(403);
  });
});

// ─── Route handler simulation ─────────────────────────────

describe('Route handler simulation (watchers/history)', () => {
  it('simulates watchers GET handler logic with shared helpers', () => {
    // This is equivalent to:
    //   const [task] = await db().select(...).where(...).limit(1);
    //   const accessError = checkTaskAccessOrRespond(task, orgId);
    //   if (accessError) return accessError;

    // Scenario: task found, same org → access granted
    const task = { id: 'task-123', organizationId: 'org-1' };
    const orgId = 'org-1';
    const error = checkTaskAccessOrRespond(task, orgId);
    expect(error).toBeNull(); // Handler continues
  });

  it('simulates watchers GET handler: task not found → 404', () => {
    const orgId = 'org-1';
    const error = checkTaskAccessOrRespond(undefined, orgId);
    expect(error).not.toBeNull();
    expect(error!.status).toBe(404);
  });

  it('simulates watchers GET handler: cross-org → 403', () => {
    const task = { id: 'task-123', organizationId: 'org-1' };
    const orgId = 'org-2';
    const error = checkTaskAccessOrRespond(task, orgId);
    expect(error).not.toBeNull();
    expect(error!.status).toBe(403);
  });

  it('simulates history GET handler: extracts task ID and queries history', () => {
    // The history route uses getTaskIdFromPath + requirePermission + db query
    const req = mockRequest('/api/tasks/task-456/history');
    const taskId = getTaskIdFromPath(req);
    expect(taskId).toBe('task-456');

    // In the actual handler, orgId is embedded in the WHERE clause via:
    //   eq(schema.tasks.organizationId, orgId!)
    // This is enforced at the query level, not via checkTaskAccess
    // But the principle is the same — org-scoped access
  });

  it('simulates watchers POST handler: same access check as GET', () => {
    // Both GET and POST in watchers use the same task existence + org scope check
    const req = mockRequest('/api/tasks/task-789/watchers');
    const taskId = getTaskIdFromPath(req);
    expect(taskId).toBe('task-789');

    // Access check is identical:
    const task = { id: taskId, organizationId: 'org-1' };
    expect(checkTaskAccessOrRespond(task, 'org-1')).toBeNull();
    expect(checkTaskAccessOrRespond(task, 'org-2')?.status).toBe(403);
    expect(checkTaskAccessOrRespond(undefined, 'org-1')?.status).toBe(404);
  });
});

// ─── Department wall ────────────────────────────────────────
// A task sub-route (comments, history, watchers, ...) must be no more
// permissive than the parent task read. /api/tasks/[id] walls a cross-department
// task behind a 404, so checkTaskAccess must apply the same wall — otherwise a
// walled user who is refused the task can still read and write its comments.

describe('checkTaskAccess — department wall', () => {
  const engTask: TaskAccessInfo = {
    id: 'task-eng',
    organizationId: 'org-1',
    departmentId: 'dept-eng',
  };

  const gm = { seeAllDepartments: true, departmentId: null };
  const salesManager = { seeAllDepartments: false, departmentId: 'dept-sales' };
  const engManager = { seeAllDepartments: false, departmentId: 'dept-eng' };

  it('allows a user in the same department', () => {
    expect(checkTaskAccess(engTask, 'org-1', { scope: engManager }).ok).toBe(true);
  });

  it('allows GM+ (sees all departments)', () => {
    expect(checkTaskAccess(engTask, 'org-1', { scope: gm }).ok).toBe(true);
  });

  it('refuses a walled user from another department', () => {
    const result = checkTaskAccess(engTask, 'org-1', { scope: salesManager });
    expect(result.ok).toBe(false);
    // 404, matching /api/tasks/[id]: a cross-dept id must be indistinguishable
    // from one that does not exist, or the wall leaks task existence.
    expect(result.ok === false && result.error.status).toBe(404);
  });

  it('refuses a walled user with no department at all', () => {
    const orphan = { seeAllDepartments: false, departmentId: null };
    expect(checkTaskAccess(engTask, 'org-1', { scope: orphan }).ok).toBe(false);
  });

  it('refuses when the task itself has no department and the user is walled', () => {
    const noDept: TaskAccessInfo = { id: 't', organizationId: 'org-1', departmentId: null };
    expect(checkTaskAccess(noDept, 'org-1', { scope: salesManager }).ok).toBe(false);
    expect(checkTaskAccess(noDept, 'org-1', { scope: gm }).ok).toBe(true);
  });

  it('stays backward compatible when no scope is supplied', () => {
    expect(checkTaskAccess(engTask, 'org-1').ok).toBe(true);
  });

  it('checkTaskAccessOrRespond returns 404 for a cross-dept task', () => {
    const res = checkTaskAccessOrRespond(engTask, 'org-1', { scope: salesManager });
    expect(res?.status).toBe(404);
    expect(checkTaskAccessOrRespond(engTask, 'org-1', { scope: engManager })).toBeNull();
  });
});

// ─── Wall consistency across a resource and its sub-routes ──
// Regression guard for the class fixed in PR #28 and after: a sub-route or a
// related-resource route must never be more permissive than the parent read.
// These assert the SHAPE every caller relies on, so a future route that passes
// a scope gets the same 404 the parent gives.

describe('checkTaskAccess — parity with the parent route', () => {
  const engTask: TaskAccessInfo = {
    id: 'task-eng',
    organizationId: 'org-1',
    departmentId: 'dept-eng',
  };
  const sales = { seeAllDepartments: false, departmentId: 'dept-sales' };

  it('refuses with 404, never 403, so the status is not an existence oracle', () => {
    const result = checkTaskAccess(engTask, 'org-1', { scope: sales });
    expect(result.ok).toBe(false);
    // 403 would confirm the task exists; the parent route answers 404.
    expect(result.ok === false && result.error.status).toBe(404);
    expect(result.ok === false && result.error.code).toBe('NOT_FOUND');
  });

  it('still refuses a cross-ORG task with 403 (org mismatch is not the wall)', () => {
    const result = checkTaskAccess(engTask, 'org-2', { scope: sales });
    expect(result.ok === false && result.error.status).toBe(403);
  });

  it('applies the org check before the department check', () => {
    // A task in another org must not be reported as merely cross-department.
    const other = { seeAllDepartments: false, departmentId: 'dept-eng' };
    const result = checkTaskAccess(engTask, 'org-2', { scope: other });
    expect(result.ok === false && result.error.code).toBe('FORBIDDEN');
  });
});
