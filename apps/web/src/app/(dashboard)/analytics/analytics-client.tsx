'use client';

import { useEffect, useState, useCallback, useMemo, useRef, startTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { STATUS_CHART_COLORS as STATUS_COLORS } from '@/lib/theme/chart-colors';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Activity,
  Target,
  GitBranch,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────

interface BurndownPoint {
  date: string;
  ideal: number;
  actual: number;
  remaining: number;
}

interface VelocityPoint {
  period: string;
  completed: number;
  created: number;
}

interface TrendData {
  completionRate: number;
  overdueRate: number;
  avgCompletionDays: number | null;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  inProgressTasks: number;
  openTasks: number;
  blockedTasks: number;
  statusDistribution: Array<{ status: string; count: number }>;
}

export interface AnalyticsData {
  burndown: BurndownPoint[];
  velocity: VelocityPoint[];
  trends: TrendData;
}

// ─── Constants ──────────────────────────────────────────────


const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  under_review: 'Under Review',
  on_hold: 'On Hold',
  completed: 'Completed',
  closed: 'Closed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

const PERIOD_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All time', days: 0 },
] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ─── Custom Tooltips ────────────────────────────────────────

interface TooltipPayloadEntry {
  color: string;
  name: string;
  value: number;
}

function BurndownTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-surface-500/20 bg-surface-50/95 neon-card rounded-xl p-3 shadow-lg backdrop-blur-xl">
      <p className="text-surface-500 mb-1 text-[10px] font-medium">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="flex items-center gap-2 text-xs" style={{ color: entry.color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold">{Math.round(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-surface-500/20 bg-surface-50/95 neon-card rounded-xl p-3 shadow-lg backdrop-blur-xl">
      <p className="text-surface-500 mb-1 text-[10px] font-medium">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="flex items-center gap-2 text-xs" style={{ color: entry.color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Trend Card ─────────────────────────────────────────────

function TrendCard({
  icon,
  label,
  value,
  sublabel,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  color: string;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'neon-card relative overflow-hidden rounded-2xl p-4 transition-all duration-200',
      )}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-60" style={{ background: `linear-gradient(to right, ${color}, ${color}88)` }} />
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}15`, color }}>
            {icon}
          </div>
          <div>
            <p className="text-surface-500 text-[10px] font-medium uppercase tracking-wider">{label}</p>
            <p className="stat-value text-surface-900 text-xl">{value}</p>
          </div>
        </div>
        {trend && (
          <div className={cn(
            'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
            trend === 'up' ? 'bg-success/10 text-success' :
            trend === 'down' ? 'bg-error/10 text-error' :
            'bg-surface-200/50 text-surface-500',
          )}>
            {trend === 'up' ? <TrendingUp className="h-3 w-3" /> :
             trend === 'down' ? <TrendingDown className="h-3 w-3" /> : null}
            {trend === 'up' && '↑'}
            {trend === 'down' && '↓'}
          </div>
        )}
      </div>
      {sublabel && (
        <p className="text-surface-400 mt-1.5 text-[10px]">{sublabel}</p>
      )}
    </motion.div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export interface AnalyticsClientProps {
  /** Server-seeded analytics for the default 30-day period; null means the server load failed and the client fetches. */
  initialData: AnalyticsData | null;
}

export function AnalyticsClient({ initialData }: AnalyticsClientProps) {
  const [hadInitialData] = useState(() => initialData !== null);
  const [data, setData] = useState<AnalyticsData | null>(initialData);
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(30);

  const fetchAnalytics = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {};
      if (days > 0) {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
        body.startDate = startDate.toISOString();
        body.endDate = endDate.toISOString();
      }

      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to load analytics');
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Skip the initial fetch when the server seeded the default-period analytics;
  // period changes still refetch (fetchAnalytics is called with the new period).
  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    startTransition(() => fetchAnalytics(period));
  }, [period, fetchAnalytics]);

  // ── Memoized chart data ─────────────────────────────────

  const pieData = useMemo(() => {
    if (!data?.trends?.statusDistribution) return [];
    return data.trends.statusDistribution.map((s) => ({
      name: STATUS_LABELS[s.status] ?? s.status,
      value: s.count,
      color: STATUS_COLORS[s.status] ?? '#6b7280',
    }));
  }, [data]);

  const avgVelocity = useMemo(() => {
    if (!data?.velocity?.length) return 0;
    const completed = data.velocity.reduce((sum, v) => sum + v.completed, 0);
    return Math.round((completed / data.velocity.length) * 10) / 10;
  }, [data]);

  const loadingContent = (
    <div className="space-y-6">
      <div className="shimmer h-8 w-32 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-24 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[1, 2].map((i) => <div key={i} className="shimmer h-72 rounded-2xl" />)}
      </div>
    </div>
  );

  if (loading && !data) return loadingContent;

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
          icon={
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <BarChart3 className="h-4 w-4 text-white" />
            </div>
          }
          title="Analytics"
          subtitle="Burndown, velocity, and project trends"
          actions={
            <div className="bg-surface-200/60 flex items-center gap-1 rounded-xl p-0.5">
              {PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  onClick={() => setPeriod(preset.days)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                    period === preset.days
                      ? 'bg-surface-300 text-surface-900 shadow-sm'
                      : 'text-surface-500 hover:text-surface-700',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {error ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center py-12">
          <AlertCircle className="text-error mb-2 h-8 w-8" />
          <p className="text-error text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchAnalytics(period)}>
            Retry
          </Button>
        </motion.div>
      ) : data ? (
        <>
          {/* Trend Cards */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TrendCard
              icon={<Target className="h-4 w-4" />}
              label="Completion Rate"
              value={`${data.trends.completionRate}%`}
              sublabel={`${data.trends.completedTasks} of ${data.trends.totalTasks} tasks`}
              trend={data.trends.completionRate >= 50 ? 'up' : 'down'}
              color="#34d399"
            />
            <TrendCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Overdue Rate"
              value={`${data.trends.overdueRate}%`}
              sublabel={`${data.trends.overdueTasks} overdue tasks`}
              trend={data.trends.overdueRate > 20 ? 'down' : data.trends.overdueRate > 0 ? 'neutral' : 'up'}
              color="#f87171"
            />
            <TrendCard
              icon={<Clock className="h-4 w-4" />}
              label="Avg Completion"
              value={data.trends.avgCompletionDays != null ? `${data.trends.avgCompletionDays}d` : '—'}
              sublabel="Days from creation to completion"
              color="#60a5fa"
            />
            <TrendCard
              icon={<Activity className="h-4 w-4" />}
              label="Weekly Velocity"
              value={avgVelocity}
              sublabel={'Avg tasks completed per week'}
              trend={avgVelocity >= 5 ? 'up' : avgVelocity >= 1 ? 'neutral' : 'down'}
              color="#a78bfa"
            />
          </motion.div>

          {/* Charts */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Burndown Chart */}
            <Card>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-surface-900 flex items-center gap-2 text-sm font-semibold">
                    <Target className="text-surface-400 h-4 w-4" />
                    Burndown Chart
                  </h2>
                  <p className="text-surface-500 mt-0.5 text-xs">Ideal vs actual task completion over time</p>
                </div>
                {data.burndown.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.burndown} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                        <defs>
                          <linearGradient id="burndownIdeal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="burndownActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-300)" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: '#6b7280' }}
                          tickFormatter={(val) => {
                            const d = new Date(val);
                            return `${d.getMonth() + 1}/${d.getDate()}`;
                          }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                        <Tooltip content={<BurndownTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="ideal"
                          stroke="#60a5fa"
                          fill="url(#burndownIdeal)"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          name="Ideal"
                        />
                        <Area
                          type="monotone"
                          dataKey="actual"
                          stroke="#a78bfa"
                          fill="url(#burndownActual)"
                          strokeWidth={2}
                          name="Actual"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center">
                    <p className="text-surface-400 text-sm">No data for the selected period</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Velocity Chart */}
            <Card>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-surface-900 flex items-center gap-2 text-sm font-semibold">
                    <Activity className="text-surface-400 h-4 w-4" />
                    Team Velocity
                  </h2>
                  <p className="text-surface-500 mt-0.5 text-xs">Tasks completed vs created per period</p>
                </div>
                {data.velocity.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.velocity} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-300)" opacity={0.3} />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 9, fill: '#6b7280' }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          wrapperStyle={{ fontSize: '10px', color: '#6b7280' }}
                        />
                        <Bar
                          dataKey="completed"
                          fill="#34d399"
                          radius={[4, 4, 0, 0]}
                          name="Completed"
                          maxBarSize={24}
                        />
                        <Bar
                          dataKey="created"
                          fill="#60a5fa"
                          radius={[4, 4, 0, 0]}
                          name="Created"
                          maxBarSize={24}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center">
                    <p className="text-surface-400 text-sm">No data for the selected period</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Status Distribution */}
            <Card>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-surface-900 flex items-center gap-2 text-sm font-semibold">
                    <GitBranch className="text-surface-400 h-4 w-4" />
                    Status Distribution
                  </h2>
                  <p className="text-surface-500 mt-0.5 text-xs">Task breakdown by current status</p>
                </div>
                {pieData.length > 0 ? (
                  <div className="flex h-64 items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={50}
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {pieData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} aria-label={`${entry.name}: ${entry.value}`} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center">
                    <p className="text-surface-400 text-sm">No tasks found</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <Card>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-surface-900 flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="text-surface-400 h-4 w-4" />
                    Task Overview
                  </h2>
                  <p className="text-surface-500 mt-0.5 text-xs">Quick snapshot of all task states</p>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'Total Tasks', value: data.trends.totalTasks, color: '#6b7280' },
                    { label: 'Completed', value: data.trends.completedTasks, color: '#34d399' },
                    { label: 'In Progress', value: data.trends.inProgressTasks, color: '#fbbf24' },
                    { label: 'Open', value: data.trends.openTasks, color: '#60a5fa' },
                    { label: 'Blocked', value: data.trends.blockedTasks, color: '#f87171' },
                    { label: 'Overdue', value: data.trends.overdueTasks, color: '#ef4444' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-xl bg-surface-200/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-surface-600 text-xs">{item.label}</span>
                      </div>
                      <span className="text-surface-900 text-xs font-semibold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}
