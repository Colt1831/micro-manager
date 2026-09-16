/**
 * Percentage of a project's tasks that are complete.
 *
 * The `projects.progress` column exists but nothing ever writes it, so the
 * list endpoint always reported 0% while the detail endpoint computed real
 * numbers from task counts — same project, two different answers. Both now
 * route through this helper.
 */
export function computeProgress(total: number, completed: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((completed / total) * 100);
  return Math.min(100, Math.max(0, pct));
}
