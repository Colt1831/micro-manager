import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Task Templates is a task-authoring aid: any role allowed to create tasks must
 * also be able to read the templates, or /task-templates renders "Failed to load
 * templates" (a raw 403 from /api/task-templates) for that entire rank.
 *
 * Regression guard for the seed shipping task_template:* to Owner/Admin/Super
 * Admin only, which left the whole rank ladder — GM included — staring at an
 * error page.
 *
 * ponytail: parses the seed source instead of seeding a DB, because seed.ts
 * auto-runs + process.exit()s on import and unit CI has no Postgres. If the
 * role bundles ever move into their own module, import them directly instead.
 */
describe('seed role permissions', () => {
  const src = readFileSync(path.resolve(__dirname, '../seed.ts'), 'utf8');

  /** Pull the permissionCodes array literal for one ensureRole({ slug }) block. */
  function permissionsFor(slug: string): string[] {
    const block = new RegExp(
      `slug:\\s*'${slug}'[\\s\\S]*?permissionCodes:\\s*(\\[[\\s\\S]*?\\]|allCodes)`,
    ).exec(src);
    expect(block, `no ensureRole block for '${slug}'`).not.toBeNull();
    const body = block![1]!;
    if (body === 'allCodes') return ['*'];
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  }

  const TASK_AUTHORING_ROLES = [
    'general_manager',
    'manager',
    'team_lead',
    'senior_executive',
    'executive',
    'member',
  ];

  it.each(TASK_AUTHORING_ROLES)('grants %s task_template:view', (slug) => {
    const perms = permissionsFor(slug);
    expect(perms).toContain('task:create');
    expect(perms).toContain('task_template:view');
  });

  it('grants template authoring to the roles that manage work', () => {
    for (const slug of ['general_manager', 'manager', 'team_lead']) {
      expect(permissionsFor(slug)).toContain('task_template:create');
    }
  });

  it('keeps full access for the admin roles', () => {
    for (const slug of ['super_admin', 'owner']) {
      expect(permissionsFor(slug)).toEqual(['*']);
    }
  });
});
