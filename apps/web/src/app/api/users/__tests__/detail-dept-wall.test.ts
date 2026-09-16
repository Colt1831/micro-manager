import { describe, it, expect } from 'vitest';
import { canAccessDept } from '@/lib/api/db';

/**
 * Department wall on the USER detail routes (spec §3).
 *
 * GET/PATCH/DELETE /api/users/[id] enforced org scope but NOT the department
 * wall, so any manager who knew a user id could read that user's email, phone,
 * designation and reporting line across the wall — and PATCH/DELETE could edit
 * or deactivate them. The spec requires the wall on "list, detail read, and
 * mutation" paths uniformly, precisely to close the "known ID is readable" hole.
 *
 * These pin the predicate those handlers now gate on.
 */
const ENG = 'dept-engineering';
const SLS = 'dept-sales';

const walledManager = { rank: 'manager', level: 40, departmentId: SLS, seeAllDepartments: false };
const generalManager = { rank: 'general_manager', level: 50, departmentId: SLS, seeAllDepartments: true };
const superAdmin = { rank: 'super_admin', level: 100, departmentId: null, seeAllDepartments: true };

describe('user detail routes — department wall', () => {
  it('denies a walled manager access to a user in another department', () => {
    expect(canAccessDept(walledManager, ENG)).toBe(false);
  });

  it('allows a walled manager access to a user in their own department', () => {
    expect(canAccessDept(walledManager, SLS)).toBe(true);
  });

  it('allows GM+ across every department', () => {
    expect(canAccessDept(generalManager, ENG)).toBe(true);
    expect(canAccessDept(generalManager, SLS)).toBe(true);
  });

  it('allows super_admin across every department', () => {
    expect(canAccessDept(superAdmin, ENG)).toBe(true);
    expect(canAccessDept(superAdmin, SLS)).toBe(true);
  });

  it('denies a walled actor when the target has no department', () => {
    // A department-less user must not be a hole in the wall.
    expect(canAccessDept(walledManager, null)).toBe(false);
  });
});
