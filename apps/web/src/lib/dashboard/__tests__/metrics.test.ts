import { describe, it, expect } from 'vitest';
import { computeDashboardMetrics, type MetricTask } from '../metrics';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function task(overrides: Partial<MetricTask>): MetricTask {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? 'Task',
    status: overrides.status ?? 'open',
    updatedAt: overrides.updatedAt ?? NOW.toISOString(),
    dueDate: overrides.dueDate ?? null,
    assignedTo: overrides.assignedTo ?? null,
    assignedToName: overrides.assignedToName ?? null,
  };
}

describe('computeDashboardMetrics', () => {
  it('counts tasks by status and computes completion rate', () => {
    const tasks = [
      task({ status: 'open' }),
      task({ status: 'in_progress' }),
      task({ status: 'blocked' }),
      task({ status: 'under_review' }),
      task({ status: 'completed' }),
      task({ status: 'closed' }),
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: 'u1', userName: 'A', now: NOW });
    expect(m.totalTasks).toBe(6);
    expect(m.inProgress).toBe(1);
    expect(m.blockedTasks).toBe(1);
    expect(m.awaitingReview).toBe(1);
    expect(m.completedTasks).toBe(1);
    expect(m.closedTasks).toBe(1);
    // completed + closed = 2 of 6 => 33%
    expect(m.completionRate).toBe(33);
    expect(m.teamCompleted).toBe(2);
  });

  it('treats open and draft as open tasks', () => {
    const m = computeDashboardMetrics(
      [task({ status: 'open' }), task({ status: 'draft' }), task({ status: 'in_progress' })],
      [], [], { myUserId: null, userName: 'A', now: NOW },
    );
    expect(m.openTasks).toBe(2);
  });

  it('flags overdue only for non-closed tasks with a past due date', () => {
    const tasks = [
      task({ status: 'open', dueDate: day(-3) }), // overdue
      task({ status: 'completed', dueDate: day(-3) }), // done -> not overdue
      task({ status: 'open', dueDate: day(3) }), // future -> not overdue
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: null, userName: 'A', now: NOW });
    expect(m.overdueTasks).toBe(1);
  });

  it('attributes my tasks by user id and by legacy name', () => {
    const tasks = [
      task({ assignedTo: 'u1', status: 'open', dueDate: day(-1) }),
      task({ assignedTo: 'Alice', status: 'open' }),
      task({ assignedTo: 'someone-else' }),
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: 'u1', userName: 'Alice', now: NOW });
    expect(m.myTasks).toBe(2);
    expect(m.myOverdue).toBe(1);
  });

  it('builds top-8 workload buckets sorted by task count, Unassigned included', () => {
    const tasks = [
      ...Array.from({ length: 3 }, () => task({ assignedTo: 'u1', status: 'completed' })),
      ...Array.from({ length: 2 }, () => task({ assignedTo: 'u2' })),
      task({ assignedTo: null }),
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: 'u1', userName: 'A', now: NOW });
    expect(m.workloadByUser[0]).toEqual({ name: 'u1', tasks: 3, completed: 3 });
    expect(m.workloadByUser.map((w) => w.name)).toContain('Unassigned');
    expect(m.workloadByUser.length).toBeLessThanOrEqual(8);
  });

  it('labels workload buckets with the assignee NAME, not the raw user id', () => {
    // The dashboard renders workloadByUser[].name directly. Keying on
    // assignedTo (a uuid) printed raw ids in the most visible panel of the app.
    const tasks = [
      task({ assignedTo: 'uuid-1', assignedToName: 'Dana Roy', status: 'completed' }),
      task({ assignedTo: 'uuid-1', assignedToName: 'Dana Roy' }),
      task({ assignedTo: 'uuid-2', assignedToName: 'Omar Naz' }),
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: 'uuid-1', userName: 'Dana Roy', now: NOW });
    expect(m.workloadByUser[0]).toEqual({ name: 'Dana Roy', tasks: 2, completed: 1 });
    expect(m.workloadByUser.map((w) => w.name)).toContain('Omar Naz');
    expect(m.workloadByUser.map((w) => w.name)).not.toContain('uuid-1');
  });

  it('falls back to the id when no name is present (legacy rows)', () => {
    const tasks = [task({ assignedTo: 'u1', status: 'completed' })];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: 'u1', userName: 'A', now: NOW });
    expect(m.workloadByUser[0]!.name).toBe('u1');
  });

  it('precomputes upcoming deadlines with isUrgent + dueLabel (max 5, soonest first)', () => {
    const tasks = [
      task({ id: 'a', title: 'soon', status: 'open', dueDate: day(1) }), // urgent (<2d)
      task({ id: 'b', title: 'later', status: 'open', dueDate: day(5) }), // not urgent
      task({ id: 'c', title: 'done', status: 'completed', dueDate: day(1) }), // excluded
      task({ id: 'd', title: 'noduedate', status: 'open', dueDate: null }), // excluded (no due date)
    ];
    const m = computeDashboardMetrics(tasks, [], [], { myUserId: null, userName: 'A', now: NOW });
    expect(m.upcomingDeadlines.map((d) => d.id)).toEqual(['a', 'b']);
    const [first, second] = m.upcomingDeadlines;
    expect(first?.isUrgent).toBe(true);
    expect(second?.isUrgent).toBe(false);
    expect(first?.dueLabel).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('counts active projects and total users/projects', () => {
    const m = computeDashboardMetrics(
      [],
      [{ status: 'active' }, { status: 'active' }, { status: 'archived' }],
      [{}, {}],
      { myUserId: null, userName: 'A', now: NOW },
    );
    expect(m.totalProjects).toBe(3);
    expect(m.activeProjects).toBe(2);
    expect(m.totalUsers).toBe(2);
  });

  it('does not mutate the input tasks array (recent-activity sort is copied)', () => {
    const tasks = [
      task({ id: 'x', updatedAt: day(-2) }),
      task({ id: 'y', updatedAt: day(-1) }),
    ];
    const order = tasks.map((t) => t.id);
    computeDashboardMetrics(tasks, [], [], { myUserId: null, userName: 'A', now: NOW });
    expect(tasks.map((t) => t.id)).toEqual(order);
  });

  it('returns 0 completion rate with no tasks (no divide-by-zero)', () => {
    const m = computeDashboardMetrics([], [], [], { myUserId: null, userName: 'A', now: NOW });
    expect(m.completionRate).toBe(0);
    expect(m.totalTasks).toBe(0);
  });
});
