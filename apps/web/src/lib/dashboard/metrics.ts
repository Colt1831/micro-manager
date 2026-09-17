/**
 * Pure dashboard-metric aggregation shared by the server loader
 * (initial server render) and the client refresh path.
 *
 * Keeping this a pure function means the server-rendered HTML and the
 * client's first (hydration) render are computed from identical inputs,
 * so there is no hydration mismatch. All time-derived display values
 * (isUrgent, dueLabel) are precomputed here from the passed `now` rather
 * than at render time, for the same reason.
 */

export interface MetricTask {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  updatedAt: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
}

export interface MetricProject {
  status: string;
}

export interface UpcomingDeadline {
  id: string;
  title: string;
  dueDate: string | null;
  status: string;
  /** true when the due date is within 2 days of `now` */
  isUrgent: boolean;
  /** preformatted short date, e.g. "Aug 13" (or "—" when no due date) */
  dueLabel: string;
}

export interface RecentActivityItem {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  assignedTo: string | null;
}

export interface DashboardMetrics {
  totalTasks: number;
  openTasks: number;
  inProgress: number;
  completedTasks: number;
  closedTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  awaitingReview: number;
  totalProjects: number;
  activeProjects: number;
  totalUsers: number;
  completionRate: number;
  myTasks: number;
  myOverdue: number;
  teamTasks: number;
  teamCompleted: number;
  upcomingDeadlines: UpcomingDeadline[];
  recentActivity: RecentActivityItem[];
  workloadByUser: Array<{ name: string; tasks: number; completed: number }>;
}

export interface ComputeMetricsOptions {
  /** Current user id, used to attribute "my tasks". */
  myUserId: string | null;
  /** Current user's display name (also matched for legacy string assignees). */
  userName: string;
  /** Reference time; defaults to now. Pass explicitly for deterministic output. */
  now?: Date;
}

const CLOSED_STATUSES = ['completed', 'closed', 'cancelled', 'archived'];
const TWO_DAYS_MS = 86_400_000 * 2;

export function computeDashboardMetrics(
  tasks: MetricTask[],
  projects: MetricProject[],
  users: unknown[],
  { myUserId, userName, now = new Date() }: ComputeMetricsOptions,
): DashboardMetrics {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const urgentThreshold = now.getTime() + TWO_DAYS_MS;

  const isOverdue = (t: MetricTask) =>
    !!t.dueDate && new Date(t.dueDate) < today && !CLOSED_STATUSES.includes(t.status);
  const isDone = (t: MetricTask) => t.status === 'completed' || t.status === 'closed';

  // My tasks (assigned to current user by id or, legacy, by name)
  const myTasks = tasks.filter(
    (t) => t.assignedTo === myUserId || t.assignedTo === userName,
  );

  // Workload by user — top 8 users by task count
  const userTaskCount = new Map<string, { tasks: number; completed: number }>();
  for (const t of tasks) {
    // Label by NAME — this string is rendered directly in the dashboard's
    // Workload Overview. Keying on assignedTo alone printed raw uuids.
    // Falls back to the id for legacy rows that carry no joined name.
    const assignee = t.assignedToName ?? t.assignedTo ?? 'Unassigned';
    const entry = userTaskCount.get(assignee) ?? { tasks: 0, completed: 0 };
    entry.tasks++;
    if (isDone(t)) entry.completed++;
    userTaskCount.set(assignee, entry);
  }
  const workloadByUser = Array.from(userTaskCount.entries())
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 8);

  const upcomingDeadlines: UpcomingDeadline[] = tasks
    .filter((t) => t.dueDate && !CLOSED_STATUSES.includes(t.status))
    .sort((a, b) => new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime())
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ?? null,
      status: t.status,
      isUrgent: !!t.dueDate && new Date(t.dueDate).getTime() < urgentThreshold,
      dueLabel: t.dueDate
        ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—',
    }));

  const recentActivity: RecentActivityItem[] = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      updatedAt: t.updatedAt,
      assignedTo: t.assignedTo ?? null,
    }));

  return {
    totalTasks: tasks.length,
    openTasks: tasks.filter((t) => t.status === 'open' || t.status === 'draft').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    closedTasks: tasks.filter((t) => t.status === 'closed').length,
    overdueTasks: tasks.filter(isOverdue).length,
    blockedTasks: tasks.filter((t) => t.status === 'blocked').length,
    awaitingReview: tasks.filter((t) => t.status === 'under_review').length,
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    totalUsers: users.length,
    completionRate: tasks.length > 0 ? Math.round((tasks.filter(isDone).length / tasks.length) * 100) : 0,
    myTasks: myTasks.length,
    myOverdue: myTasks.filter(isOverdue).length,
    teamTasks: tasks.length,
    teamCompleted: tasks.filter(isDone).length,
    upcomingDeadlines,
    recentActivity,
    workloadByUser,
  };
}
