'use client';

import { useEffect, useState, useCallback, lazy, Suspense, startTransition, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { staggerContainer, fadeUpItem } from '@/lib/motion/variants';
import { statusChartColor, priorityChartColor } from '@/lib/theme/chart-colors';
import { motion } from 'framer-motion';
import {
  ListTodo,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Users,
  Target,
  Activity,
  Plus,
  Search,
  Calendar as CalendarIcon,
  BarChart3,
  Briefcase,
  User,
  Sparkles,
} from 'lucide-react';
import { TeamActivityFeed } from '@/components/dashboard/team-activity-feed';
import { EODReportWidget } from '@/components/dashboard/eod-report-widget';
import { useNotificationSSE } from '@/lib/hooks/use-notification-sse';
import { useNotificationStore } from '@/stores/notification-store';
import { cn } from '@/lib/utils';
import { computeDashboardMetrics, type DashboardMetrics } from '@/lib/dashboard/metrics';

const RechartsCharts = lazy(() => import('@/components/dashboard/recharts-charts'));

type DashboardView = 'executive' | 'manager' | 'employee';

const containerVariants = staggerContainer(0.05);
const itemVariants = fadeUpItem({ y: 20, scale: 0.95 });

const statusDotColors: Record<string, string> = {
  draft: 'bg-surface-400',
  open: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  under_review: 'bg-cyan-500',
  on_hold: 'bg-purple-500',
  completed: 'bg-green-500',
  closed: 'bg-indigo-500',
  cancelled: 'bg-surface-400',
  archived: 'bg-surface-500',
} as const;
const statusColors: Record<
  string,
  'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
> = {
  draft: 'default',
  open: 'primary',
  in_progress: 'warning',
  blocked: 'danger',
  under_review: 'info',
  on_hold: 'warning',
  completed: 'success',
  closed: 'primary',
  reopened: 'warning',
  cancelled: 'default',
  archived: 'default',
};

const VIEW_TABS: { key: DashboardView; label: string; icon: typeof BarChart3; description: string }[] = [
  { key: 'executive', label: 'Executive', icon: BarChart3, description: 'Org-wide KPIs and health' },
  { key: 'manager', label: 'Manager', icon: Briefcase, description: 'Team metrics and workload' },
  { key: 'employee', label: 'Employee', icon: User, description: 'Personal tasks and productivity' },
];

interface DashboardClientProps {
  /** Server-rendered metrics; null means the server fetch failed and the client should load them. */
  initialMetrics: DashboardMetrics | null;
  initialUserName: string;
}

export function DashboardClient({ initialMetrics, initialUserName }: DashboardClientProps) {
  // When the server provided metrics, first paint already has real content —
  // skip the loading skeleton and the entrance fade so LCP is the real KPIs.
  // Computed once (lazy initial state); the prop is stable for this mount.
  const [hadInitialData] = useState(() => initialMetrics !== null);

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(initialMetrics);
  const [loading, setLoading] = useState(initialMetrics === null);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState(initialUserName);
  const [view, setView] = useState<DashboardView>('executive');

  const fetchMetrics = useCallback(async () => {
    try {
      const [tasksRes, projectsRes, usersRes, sessionRes] = await Promise.all([
        fetch('/api/tasks?limit=500'),
        fetch('/api/projects?limit=500'),
        fetch('/api/users?limit=500'),
        fetch('/api/auth/get-session').catch(() => new Response('{}')),
      ]);
      if (!tasksRes.ok || !projectsRes.ok || !usersRes.ok)
        throw new Error('Failed to fetch dashboard data');
      const { tasks } = await tasksRes.json();
      const { projects } = await projectsRes.json();
      const { users } = await usersRes.json();

      let myUserId: string | null = null;
      let sessionUserName = 'User';
      try {
        const sessionData = await sessionRes.json();
        if (sessionData?.user?.id) myUserId = sessionData.user.id;
        if (sessionData?.user?.name) sessionUserName = sessionData.user.name;
      } catch { /* best-effort */ }
      setUserName(sessionUserName);

      setMetrics(computeDashboardMetrics(tasks, projects, users, { myUserId, userName: sessionUserName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Real-time SSE notifications ────────────────────────────
  useNotificationSSE();
  const sseUnreadCount = useNotificationStore((s) => s.unreadCount);
  const [activityRefreshCounter, setActivityRefreshCounter] = useState(0);
  const prevUnreadRef = useRef(sseUnreadCount);

  // When unreadCount increases via SSE, bump the refresh counter
  // to trigger an immediate refetch of the TeamActivityFeed.
  // The notification badge + feed refresh provide feedback without
  // requiring a toast (which could spam the user on batch events).
  useEffect(() => {
    if (prevUnreadRef.current !== 0 && sseUnreadCount > prevUnreadRef.current) {
      setActivityRefreshCounter((c) => c + 1);
    }
    prevUnreadRef.current = sseUnreadCount;
  }, [sseUnreadCount]);

  // Only fetch on mount when the server did not provide metrics (fallback path).
  // When server data is present, first paint already has content — refetching
  // on mount would just reintroduce the client waterfall we are removing.
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchMetrics();
    });
  }, [hadInitialData, fetchMetrics]);

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-72 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-5">
              <div className="shimmer h-3 w-20 rounded-lg" />
              <div className="shimmer mt-3 h-8 w-16 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-6">
              <div className="shimmer h-4 w-36 rounded-lg" />
              <div className="mt-4 space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="shimmer h-10 rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fade-in flex h-96 items-center justify-center">
        <Card className="border-error/20 w-full max-w-md">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <div className="bg-error/10 flex h-14 w-14 items-center justify-center rounded-full">
              <AlertTriangle className="text-error h-6 w-6" />
            </div>
            <h2 className="text-surface-900 mt-4 text-lg font-semibold">Failed to load dashboard</h2>
            <p className="text-surface-500 mt-1.5 text-sm">{error}</p>
            <Button variant="default" onClick={() => { setLoading(true); setError(null); fetchMetrics(); }} className="mt-4">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!metrics) return null;

  // ── KPI cards per view ─────────────────────────────────────

  const executiveKpis = [
    { label: 'Total Tasks', value: metrics.totalTasks, icon: ListTodo, gradient: 'from-blue-500 to-blue-400', iconBg: 'bg-blue-500/10 text-blue-400', trend: null as string | null, trendUp: undefined as boolean | undefined },
    { label: 'In Progress', value: metrics.inProgress, icon: Activity, gradient: 'from-amber-500 to-yellow-400', iconBg: 'bg-amber-500/10 text-amber-400', trend: null, trendUp: undefined },
    { label: 'Overdue', value: metrics.overdueTasks, icon: Clock, gradient: 'from-red-500 to-rose-400', iconBg: 'bg-red-500/10 text-red-400', trend: null, trendUp: undefined },
    { label: 'Blocked', value: metrics.blockedTasks, icon: AlertTriangle, gradient: 'from-orange-500 to-amber-400', iconBg: 'bg-orange-500/10 text-orange-400', trend: null, trendUp: undefined },
    { label: 'Completed', value: metrics.completedTasks, icon: CheckCircle2, gradient: 'from-green-500 to-emerald-400', iconBg: 'bg-green-500/10 text-green-400', trend: '+18%', trendUp: true },
    { label: 'Completion Rate', value: `${metrics.completionRate}%`, icon: TrendingUp, gradient: 'from-purple-500 to-violet-400', iconBg: 'bg-purple-500/10 text-purple-400', trend: null, trendUp: undefined },
    { label: 'Active Projects', value: metrics.activeProjects, icon: Target, gradient: 'from-indigo-500 to-blue-400', iconBg: 'bg-indigo-500/10 text-indigo-400', trend: null, trendUp: undefined },
    { label: 'Team Members', value: metrics.totalUsers, icon: Users, gradient: 'from-teal-500 to-cyan-400', iconBg: 'bg-teal-500/10 text-teal-400', trend: null, trendUp: undefined },
  ];

  const managerKpis = [
    { label: 'Team Tasks', value: metrics.teamTasks, icon: ListTodo, gradient: 'from-blue-500 to-blue-400', iconBg: 'bg-blue-500/10 text-blue-400', trend: null, trendUp: undefined },
    { label: 'Team Completed', value: metrics.teamCompleted, icon: CheckCircle2, gradient: 'from-green-500 to-emerald-400', iconBg: 'bg-green-500/10 text-green-400', trend: null, trendUp: undefined },
    { label: 'Overdue', value: metrics.overdueTasks, icon: Clock, gradient: 'from-red-500 to-rose-400', iconBg: 'bg-red-500/10 text-red-400', trend: null, trendUp: undefined },
    { label: 'In Progress', value: metrics.inProgress, icon: Activity, gradient: 'from-amber-500 to-yellow-400', iconBg: 'bg-amber-500/10 text-amber-400', trend: null, trendUp: undefined },
    { label: 'Completion Rate', value: `${metrics.completionRate}%`, icon: TrendingUp, gradient: 'from-purple-500 to-violet-400', iconBg: 'bg-purple-500/10 text-purple-400', trend: null, trendUp: undefined },
    { label: 'Awaiting Review', value: metrics.awaitingReview, icon: Target, gradient: 'from-cyan-500 to-teal-400', iconBg: 'bg-cyan-500/10 text-cyan-400', trend: null, trendUp: undefined },
  ];

  const employeeKpis = [
    { label: 'My Tasks', value: metrics.myTasks, icon: ListTodo, gradient: 'from-blue-500 to-blue-400', iconBg: 'bg-blue-500/10 text-blue-400', trend: null, trendUp: undefined },
    { label: 'My Overdue', value: metrics.myOverdue, icon: Clock, gradient: 'from-red-500 to-rose-400', iconBg: 'bg-red-500/10 text-red-400', trend: null, trendUp: undefined },
    { label: 'Team Completed', value: metrics.teamCompleted, icon: CheckCircle2, gradient: 'from-green-500 to-emerald-400', iconBg: 'bg-green-500/10 text-green-400', trend: null, trendUp: undefined },
    { label: 'Completion Rate', value: `${metrics.completionRate}%`, icon: TrendingUp, gradient: 'from-purple-500 to-violet-400', iconBg: 'bg-purple-500/10 text-purple-400', trend: null, trendUp: undefined },
  ];

  const kpis = view === 'executive' ? executiveKpis : view === 'manager' ? managerKpis : employeeKpis;

  // ── Quick actions ──────────────────────────────────────────

  const quickActions = [
    { label: 'New Task', icon: Plus, href: '/tasks', shortcut: '⌘T', color: 'text-brand-500 bg-brand-500/10' },
    { label: 'Search', icon: Search, href: '#', shortcut: '⌘K', color: 'text-surface-500 bg-surface-200/50' },
    { label: 'Calendar', icon: CalendarIcon, href: '/calendar', shortcut: null, color: 'text-indigo-500 bg-indigo-500/10' },
    { label: 'Reports', icon: BarChart3, href: '/reports', shortcut: null, color: 'text-emerald-500 bg-emerald-500/10' },
  ];

  const KPI_COLOR: Record<string, string> = {
    'bg-blue-500/10 text-blue-400': '#60a5fa',
    'bg-amber-500/10 text-amber-400': '#fbbf24',
    'bg-red-500/10 text-red-400': '#f87171',
    'bg-orange-500/10 text-orange-400': '#fb923c',
    'bg-green-500/10 text-green-400': '#34d399',
    'bg-purple-500/10 text-purple-400': '#a78bfa',
    'bg-indigo-500/10 text-indigo-400': '#818cf8',
    'bg-teal-500/10 text-teal-400': '#2dd4bf',
    'bg-cyan-500/10 text-cyan-400': '#22d3ee',
  };

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <PageHeader
          className="mb-0"
          title="Dashboard"
          subtitle={
            <>
              Welcome back, <span className="text-surface-700 font-medium">{userName}</span>
            </>
          }
          actions={
            <div className="text-surface-500 flex items-center gap-2 text-xs">
              <span className="flex h-2 w-2 rounded-full bg-green-500" />
              <span>All systems operational</span>
            </div>
          }
        />
      </motion.div>

      {/* View Switcher Tabs */}
      <motion.div variants={itemVariants} className="flex gap-1 rounded-xl border border-surface-300/20 bg-surface-100/50 p-1 overflow-x-auto">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-all duration-200 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs',
              view === tab.key
                ? 'bg-surface-300 text-surface-900 shadow-sm'
                : 'text-surface-500 hover:text-surface-700 hover:bg-surface-200/50 ',
            )}
          >
            <tab.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="sm:inline">{tab.label}</span>
            <span className="text-surface-600 hidden text-[10px] sm:inline">— {tab.description}</span>
          </button>
        ))}
      </motion.div>

      {/* KPI Grid */}
      <div className={cn(
        'grid gap-4',
        view === 'employee' ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
      )}>
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} variants={itemVariants} custom={i}>
            <motion.div className="h-full">
              <StatCard
                label={kpi.label}
                value={kpi.value}
                icon={<kpi.icon className="h-4 w-4" />}
                color={KPI_COLOR[kpi.iconBg] ?? 'var(--color-brand-500)'}
                delta={kpi.trend ?? undefined}
                trend={kpi.trend ? (kpi.trendUp ? 'up' : 'down') : undefined}
                className="h-full"
              />
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-6">
                <div className="shimmer h-4 w-36 rounded-lg" />
                <div className="shimmer mt-6 h-48 rounded-xl" />
              </div>
            ))}
          </div>
        }
      >
        <RechartsCharts
          donutData={[
            { name: 'Open', value: metrics.openTasks },
            { name: 'In Progress', value: metrics.inProgress },
            { name: 'Completed', value: metrics.completedTasks },
            { name: 'Blocked', value: metrics.blockedTasks },
            { name: 'Review', value: metrics.awaitingReview },
          ].filter((d) => d.value > 0)}
          barData={[
            { name: 'Overdue', value: metrics.overdueTasks, fill: statusChartColor('blocked') },
            { name: 'Blocked', value: metrics.blockedTasks, fill: priorityChartColor('high') },
            { name: 'Review', value: metrics.awaitingReview, fill: statusChartColor('under_review') },
            { name: 'In Progress', value: metrics.inProgress, fill: statusChartColor('in_progress') },
            { name: 'Completed', value: metrics.completedTasks, fill: statusChartColor('completed') },
          ]}
          total={metrics.totalTasks || 1}
          pieColors={[
            statusChartColor('open'),
            statusChartColor('in_progress'),
            statusChartColor('completed'),
            statusChartColor('blocked'),
            statusChartColor('under_review'),
          ]}
        />
      </Suspense>

      {/* Quick Actions + Workload Row (Manager/Executive views) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Quick Actions Panel */}
        <motion.div variants={itemVariants} className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="text-surface-500 h-4 w-4" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((action) => (
                  <motion.a
                    key={action.label}
                    href={action.href}
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'group neon-card flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all duration-200',
                    )}
                  >
                    <div className={cn('rounded-xl p-2.5 transition-all duration-300 group-hover:scale-110 group-hover:shadow-sm', action.color)}>
                      <action.icon className="h-5 w-5" />
                    </div>
                    <span className="text-surface-700 text-sm font-medium">{action.label}</span>
                    {action.shortcut && (
                      <kbd className="border-surface-500/20 bg-surface-300/40 text-surface-500 rounded-md border px-1.5 py-0.5 text-[9px] font-medium">
                        {action.shortcut}
                      </kbd>
                    )}
                  </motion.a>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Workload Overview (manager/executive) */}
        {(view === 'executive' || view === 'manager') && (
          <motion.div variants={itemVariants} className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Users className="text-surface-400 h-4 w-4" />
                  Workload Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.workloadByUser.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-center">
                    <Users className="text-surface-300 h-8 w-8" />
                    <p className="text-surface-500 mt-2 text-sm font-medium">No workload data</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {metrics.workloadByUser.map((user, i) => {
                      const completionPct = user.tasks > 0 ? Math.round((user.completed / user.tasks) * 100) : 0;
                      return (
                        <motion.div
                          key={user.name}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="group flex items-center gap-4"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[11px] font-medium text-white shadow-sm">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-surface-700 truncate text-sm font-medium">
                                {user.name}
                              </span>
                              <span className="text-surface-500 ml-2 shrink-0 text-xs tabular-nums">
                                {user.completed}/{user.tasks}
                              </span>
                            </div>
                            <div className="bg-surface-200/70 mt-1 h-2 w-full overflow-hidden rounded-full">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${completionPct}%` }}
                                transition={{ duration: 0.8, delay: i * 0.05 + 0.2 }}
                                className={cn(
                                  'h-full rounded-full transition-all duration-500',
                                  completionPct >= 80 ? 'bg-green-500' :
                                  completionPct >= 50 ? 'bg-amber-500' :
                                  completionPct >= 25 ? 'bg-orange-500' : 'bg-red-500',
                                )}
                              />
                            </div>
                            <div className="mt-0.5 flex items-center justify-between">
                              <span className="text-surface-400 text-[10px]">Completion rate</span>
                              <span className={cn(
                                'text-[10px] font-medium tabular-nums',
                                completionPct >= 80 ? 'text-green-500' :
                                completionPct >= 50 ? 'text-amber-500' :
                                completionPct >= 25 ? 'text-orange-500' : 'text-red-500',
                              )}>
                                {completionPct}%
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Employee: My Tasks Summary (instead of workload) */}
        {view === 'employee' && (
          <motion.div variants={itemVariants} className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <ListTodo className="text-surface-400 h-4 w-4" />
                  My Task Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { label: 'My Tasks', value: metrics.myTasks, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                    { label: 'Overdue', value: metrics.myOverdue, color: 'text-red-500', bg: 'bg-red-500/10' },
                    { label: 'Team Rate', value: `${metrics.completionRate}%`, color: 'text-green-500', bg: 'bg-green-500/10' },
                    { label: 'In Progress', value: metrics.inProgress, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                  ].map((stat) => (
                    <div key={stat.label} className="border-surface-300/20 flex flex-col items-center rounded-xl border p-4 text-center">
                      <span className={cn('text-2xl font-bold', stat.color)}>{stat.value}</span>
                      <span className="text-surface-500 mt-1 text-xs font-medium">{stat.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Deadlines & Activity Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming Deadlines */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Clock className="text-surface-400 h-4 w-4" />
                Upcoming Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent>
              {metrics.upcomingDeadlines.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <CheckCircle2 className="text-success/50 h-8 w-8" />
                  <p className="text-surface-500 mt-2 text-sm font-medium">All caught up!</p>
                  <p className="text-surface-500 text-xs">No upcoming deadlines</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {metrics.upcomingDeadlines.map((task, i) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`group flex items-center justify-between rounded-xl border p-3 text-sm transition-all duration-200 hover:shadow-sm ${
                        task.isUrgent
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-surface-300/20 bg-surface-100/50'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className={`h-2 w-2 shrink-0 rounded-full ${statusDotColors[task.status] ?? 'bg-surface-400'}`} />
                        <span className="text-surface-700 group-hover:text-brand-400 truncate transition-colors">{task.title}</span>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        <Badge variant={statusColors[task.status] ?? 'default'} size="sm">
                          {task.status.replace(/_/g, ' ')}
                        </Badge>
                        <span className={`text-xs font-medium ${task.isUrgent ? 'text-error' : 'text-surface-500'}`}>
                          {task.dueLabel}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Activity — Real-time Team Activity Feed */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <div className="relative">
                  <Activity className="text-surface-400 h-4 w-4" />
                  {sseUnreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand-500 text-[7px] font-bold text-white">
                      {sseUnreadCount > 9 ? '9+' : sseUnreadCount}
                    </span>
                  )}
                </div>
                Team Activity
                {sseUnreadCount > 0 && (
                  <span className="bg-brand-500/10 text-brand-500 ml-1 animate-pulse rounded-full px-1.5 py-0 text-[9px] font-semibold">
                    {sseUnreadCount} new
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <TeamActivityFeed maxItems={20} refreshCounter={activityRefreshCounter} />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* EOD Report Widget */}
      <EODReportWidget />
    </motion.div>
  );
}
