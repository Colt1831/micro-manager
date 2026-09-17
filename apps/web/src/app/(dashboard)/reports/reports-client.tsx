'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state-display';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Loader2,
  Camera,
  Download,
  FileText,
  LineChart,
  Timer,
  UserCheck,
  FolderKanban,
  ListTodo,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Sparkles,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { computeReportMetrics } from './metrics';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

// ─── Types ──────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  snapshotDate: string;
  snapshotType: string;
  label: string | null;
  summary: Record<string, unknown> | null;
  createdAt: string;
}

// MetricTask/MetricProject/computeReportMetrics live in ./metrics (a server-safe
// module) so the RSC page.tsx can compute the seed metrics too.

interface TimeReportDay {
  date: string;
  hours: number;
  totalMinutes: number;
  count: number;
}

interface TimeReportUser {
  userId: string;
  userName: string;
  hours: number;
  totalMinutes: number;
  entryCount: number;
}

interface TimeReportProject {
  projectId: string;
  projectName: string;
  hours: number;
  totalMinutes: number;
  entryCount: number;
}

interface TimeReportTask {
  taskId: string;
  title: string;
  taskIdDisplay: string;
  hours: number;
  totalMinutes: number;
  entryCount: number;
}

interface TimeReport {
  totalHours: number;
  totalMinutes: number;
  entryCount: number;
  avgSessionMinutes: number;
  dailyHours: TimeReportDay[];
  byUser: TimeReportUser[];
  byProject: TimeReportProject[];
  topTasks: TimeReportTask[];
}

// ─── View Tabs ──────────────────────────────────────────────

type ReportTab = 'overview' | 'time' | 'builder';

const TABS: { key: ReportTab; label: string; icon: typeof Eye }[] = [
  { key: 'overview', label: 'Overview', icon: Eye },
  { key: 'time', label: 'Time Tracking', icon: Timer },
  { key: 'builder', label: 'Report Builder', icon: FileText },
];

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
} as const;

const slideVariants = {
  enter: { x: 20, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -20, opacity: 0 },
  transition: { type: 'spring', stiffness: 200, damping: 24 },
} as const;

// ─── KPI Card Colors ───────────────────────────────────────

const KPI_CARD_STYLES: Record<
  string,
  { iconBg: string; trend?: { value: string; up: boolean } }
> = {
  'Total Tasks': {
    iconBg: 'bg-blue-500/10 text-blue-400',
    trend: { value: '+12%', up: true },
  },
  'In Progress': {
    iconBg: 'bg-amber-500/10 text-amber-400',
  },
  Completed: {
    iconBg: 'bg-green-500/10 text-green-400',
    trend: { value: '+18%', up: true },
  },
  Closed: {
    iconBg: 'bg-emerald-500/10 text-emerald-400',
  },
  Blocked: {
    iconBg: 'bg-red-500/10 text-red-400',
  },
  Overdue: {
    iconBg: 'bg-orange-500/10 text-orange-400',
    trend: { value: '-5%', up: true },
  },
  'Completed This Week': {
    iconBg: 'bg-teal-500/10 text-teal-400',
  },
  'Completion Rate': {
    iconBg: 'bg-purple-500/10 text-purple-400',
  },
} as const;

// ─── Main Page ──────────────────────────────────────────────

export interface ReportsClientProps {
  /** Server-computed overview metrics; null means the server load failed and the client fetches on mount. */
  initialMetrics: Record<string, number> | null;
  initialSnapshots: Snapshot[];
}

export function ReportsClient({ initialMetrics, initialSnapshots }: ReportsClientProps) {
  const { toast } = useToast();
  const [hadInitialData] = useState(() => initialMetrics !== null);
  const [loading, setLoading] = useState(initialMetrics === null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number>>(initialMetrics ?? {});
  const [recentSnapshots, setRecentSnapshots] = useState<Snapshot[]>(initialSnapshots);
  const [timeReport, setTimeReport] = useState<TimeReport | null>(null);
  const [timeReportLoading, setTimeReportLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState<'week' | 'month' | 'quarter'>('week');
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const [generatingAiSummaries, setGeneratingAiSummaries] = useState<Set<string>>(new Set());

  // ── Fetch overview data ──────────────────────────────────
  useEffect(() => {
    if (hadInitialData) return; // server already seeded metrics + snapshots
    async function fetchData() {
      try {
        const [tasksRes, projectsRes, snapshotsRes] = await Promise.all([
          fetch('/api/tasks'),
          fetch('/api/projects'),
          fetch('/api/reports/snapshots?limit=5'),
        ]);
        if (!tasksRes.ok || !projectsRes.ok) throw new Error('Failed to fetch report data');
        const { tasks } = await tasksRes.json();
        const { projects } = await projectsRes.json();
        if (snapshotsRes.ok) {
          const snapData = await snapshotsRes.json();
          setRecentSnapshots(snapData.snapshots ?? []);
        }
        setMetrics(computeReportMetrics(tasks, projects, Date.now()));
      } catch {
        /* */
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [hadInitialData]);

  // ── Fetch time reports ──────────────────────────────────
  const fetchTimeReport = useCallback(async () => {
    setTimeReportLoading(true);
    try {
      const res = await fetch(`/api/reports/time?period=${timePeriod}`);
      if (res.ok) {
        setTimeReport(await res.json());
      }
    } catch {
      // Silent
    } finally {
      setTimeReportLoading(false);
    }
  }, [timePeriod]);

  useEffect(() => {
    fetchTimeReport();
  }, [fetchTimeReport]);

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setTimePeriod('week');
      else if (e.key === '2') setTimePeriod('month');
      else if (e.key === '3') setTimePeriod('quarter');
      else if (e.key === 't' || e.key === 'T') handleGenerateSnapshot();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Snapshot ─────────────────────────────────────────────
  async function handleGenerateSnapshot() {
    setGenerating(true);
    try {
      const res = await fetch('/api/reports/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: `EOD Report - ${new Date().toLocaleDateString()}`,
          snapshotType: 'eod',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? 'Failed to generate snapshot');
      }
      toast({
        title: 'Snapshot generated',
        description: 'EOD report snapshot has been saved as an immutable record.',
      });
      const snapRes = await fetch('/api/reports/snapshots?limit=5');
      if (snapRes.ok) {
        const snapData = await snapRes.json();
        setRecentSnapshots(snapData.snapshots ?? []);
      }
    } catch (err) {
      toast({
        title: 'Failed to generate snapshot',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setGenerating(false);
    }
  }

  // ── AI Summary ──────────────────────────────────────────
  async function handleGenerateAiSummary(snapshotId: string) {
    setGeneratingAiSummaries((prev) => {
      const next = new Set(prev);
      next.add(snapshotId);
      return next;
    });
    try {
      const res = await fetch(`/api/reports/snapshots/${snapshotId}/ai-summary`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? 'Failed to generate AI summary');
      }
      const data = await res.json();
      // Update the snapshot in local state with the new AI summary
      setRecentSnapshots((prev) =>
        prev.map((s) =>
          s.id === snapshotId ? { ...s, summary: data.summary as Record<string, unknown> } : s,
        ),
      );
      toast({
        title: 'AI summary generated',
        description: 'AI summary generated for this snapshot.',
      });
    } catch (err) {
      toast({
        title: 'Failed to generate AI summary',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setGeneratingAiSummaries((prev) => {
        const next = new Set(prev);
        next.delete(snapshotId);
        return next;
      });
    }
  }

  // ── Export ───────────────────────────────────────────────
  async function handleExport(type: string) {
    setExporting(type);
    try {
      const res = await fetch(`/api/reports/export?type=${type}`, { method: 'GET' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? 'Failed to export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${type}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: 'Export complete',
        description: `${type.charAt(0).toUpperCase() + type.slice(1)} report downloaded as CSV.`,
      });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setExporting(null);
    }
  }

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-36 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-56 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="neon-card rounded-2xl p-5">
              <div className="shimmer h-3 w-20 rounded-lg" />
              <div className="shimmer mt-3 h-8 w-16 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="neon-card rounded-2xl p-6">
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

  const hasMetrics = Object.keys(metrics).length > 0;

  const reportCards = hasMetrics
    ? [
        { label: 'Total Tasks', value: metrics.totalTasks ?? 0, icon: BarChart3 },
        { label: 'In Progress', value: metrics.inProgress ?? 0, icon: TrendingUp },
        { label: 'Completed', value: metrics.completed ?? 0, icon: CheckCircle2 },
        { label: 'Closed', value: metrics.closed ?? 0, icon: CheckCircle2 },
        { label: 'Blocked', value: metrics.blocked ?? 0, icon: AlertTriangle },
        { label: 'Overdue', value: metrics.overdue ?? 0, icon: Clock },
        { label: 'Completed This Week', value: metrics.completedThisWeek ?? 0, icon: TrendingUp },
        { label: 'Completion Rate', value: `${metrics.completionRate ?? 0}%`, icon: TrendingUp },
      ]
    : [];

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="space-y-6"
    >
      {/* ── Header ────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-surface-900 text-2xl font-bold tracking-tight">
            Reports
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            Task performance and productivity metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSnapshot}
            disabled={generating}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {generating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="mr-1 h-3.5 w-3.5" />
            )}
            {generating ? 'Capturing...' : 'Snapshot'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={exporting !== null}
                className="h-8 rounded-lg px-2.5 text-xs"
              >
                {exporting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                {exporting ? 'Exporting...' : 'Export'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuLabel>Export as CSV</DropdownMenuLabel>
              {['tasks', 'projects', 'users'].map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => handleExport(type)}
                >
                  <FileText className="h-4 w-4" />
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <div
          className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
          role="tablist"
          aria-label="Report sections"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-surface-50 text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700 '
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ── Tab Content ───────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="space-y-6"
          >
            {/* KPI Cards */}
            {hasMetrics && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {reportCards.map((card) => {
                  const style = KPI_CARD_STYLES[card.label] ?? {
                    iconBg: 'bg-brand-500/10 text-brand-400',
                  };

                  return (
                    <motion.div key={card.label} variants={itemVariants}>
                      <div className="neon-card group relative overflow-hidden rounded-xl p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1.5">
                            <p className="text-surface-600 text-[11px] font-medium uppercase tracking-wide">
                              {card.label}
                            </p>
                            <div className="flex items-baseline gap-2">
                              <p className="text-surface-950 text-[32px] font-semibold leading-none tracking-tight">
                                {card.value}
                              </p>
                              {style.trend && (
                                <span
                                  className={`flex items-center gap-0.5 text-[11px] font-medium ${
                                    style.trend.up
                                      ? 'text-success'
                                      : 'text-error'
                                  }`}
                                >
                                  {style.trend.up ? (
                                    <ArrowUpRight className="h-3 w-3" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3" />
                                  )}
                                  {style.trend.value}
                                </span>
                              )}
                            </div>
                          </div>
                          <div
                            className={`rounded-xl p-2.5 ${style.iconBg} transition-all duration-300 group-hover:scale-110 group-hover:shadow-sm`}
                          >
                            <card.icon className="h-5 w-5" />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Snapshots */}
            {recentSnapshots.length > 0 && (
              <motion.div variants={itemVariants}>
                <Card>
                  <CardContent className="p-5">
                    <h3 className="text-surface-900 mb-4 flex items-center gap-2 text-sm font-semibold">
                      <Camera className="text-brand-500 h-4 w-4" />
                      Recent Report Snapshots
                    </h3>
                    <div className="space-y-2">
                      {recentSnapshots.map((snap, i) => {
                      const summary = snap.summary as Record<string, unknown> | null;
                      const aiSummary = summary?.aiSummary as string | undefined | null;
                      const isExpanded = expandedSummaries.has(snap.id);
                      const summaryText = aiSummary ?? '';
                      const isLongSummary = summaryText.length > 140;
                      const isGenerating = generatingAiSummaries.has(snap.id);
                      const hasSummaryData = summary && typeof summary.totalTasks === 'number';

                      return (
                        <motion.div
                          key={snap.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="neon-card hover:bg-surface-200/30 rounded-xl p-3 text-sm transition-all duration-200"
                        >
                          <div className="space-y-2">
                            <Link
                              href={`/reports/snapshots/${snap.id}`}
                              className="flex items-start justify-between group"
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div className="bg-brand-500/10 text-brand-500 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                                  <Camera className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-surface-900 font-medium group-hover:text-brand-500 transition-colors">
                                    {snap.label ?? `Snapshot — ${snap.snapshotDate}`}
                                  </span>
                                  <div className="text-surface-500 mt-0.5 flex items-center gap-2">
                                    <span className="text-[11px]">
                                      {new Date(snap.createdAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                    <span className="text-surface-300 ">·</span>
                                    <Badge variant="default" size="sm" className="text-[9px]">
                                      {snap.snapshotType.toUpperCase()}
                                    </Badge>
                                  </div>
                                </div>
                              </div>

                              {summary && (
                                <div className="flex shrink-0 items-center gap-3 ml-3">
                                  <span className="text-surface-500 text-xs whitespace-nowrap">
                                    <span className="font-medium text-surface-700 ">
                                      {String(summary.totalTasks ?? '—')}
                                    </span>{' '}
                                    tasks
                                  </span>
                                </div>
                              )}
                            </Link>

                            {/* AI Summary — present */}
                            {aiSummary && (
                              <div className="pl-11">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Sparkles className="h-3 w-3 text-amber-400" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                                    AI Summary
                                  </span>
                                </div>
                                <p className="text-surface-600 text-xs leading-relaxed">
                                  {isLongSummary && !isExpanded
                                    ? summaryText.slice(0, 140) + '…'
                                    : summaryText}
                                </p>
                                {isLongSummary && (
                                  <button
                                    onClick={() => {
                                      setExpandedSummaries((prev) => {
                                        const next = new Set(prev);
                                        if (isExpanded) next.delete(snap.id);
                                        else next.add(snap.id);
                                        return next;
                                      });
                                    }}
                                    className="text-amber-500 hover:text-amber-400 mt-0.5 text-[10px] font-medium transition-colors"
                                  >
                                    {isExpanded ? 'Show less' : 'Show more'}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Generate AI Summary — prompt */}
                            {!aiSummary && hasSummaryData && (
                              <div className="pl-11 flex items-center gap-2">
                                <button
                                  onClick={() => handleGenerateAiSummary(snap.id)}
                                  disabled={isGenerating}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] font-medium text-amber-500 transition-all duration-200 hover:bg-amber-500/10 hover:border-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isGenerating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3 w-3" />
                                  )}
                                  {isGenerating ? 'Generating...' : 'Generate AI Summary'}
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Empty state */}
            {!hasMetrics && (
              <motion.div variants={itemVariants}>
                <EmptyState
                  icon={<LineChart className="text-surface-300 h-16 w-16" />}
                  title="No data available"
                  message="Create some tasks and projects to start seeing reports."
                />
              </motion.div>
            )}

            {/* Keyboard shortcuts hint */}
            {hasMetrics && (
              <motion.div
                variants={itemVariants}
                className="flex items-center justify-center gap-3 text-[10px] text-surface-400"
              >
                <span>Switch to</span>
                <kbd className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">
                  Time Tracking
                </kbd>
                <span>tab or press</span>
                <kbd className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">
                  T
                </kbd>
                <span>for snapshot</span>
              </motion.div>
            )}
          </motion.div>
        )}

        {activeTab === 'builder' && (
          <motion.div
            key="builder"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="space-y-6"
          >
            {/* Template selection */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="text-surface-400 h-4 w-4" />
                    Report Template
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                      { id: 'task-status', label: 'Task Status', icon: BarChart3, desc: 'Task distribution by status and priority' },
                      { id: 'user-perf', label: 'User Performance', icon: UserCheck, desc: 'Completion rates per team member' },
                      { id: 'project-progress', label: 'Project Progress', icon: FolderKanban, desc: 'Project milestones and completion' },
                      { id: 'task-aging', label: 'Task Aging', icon: Clock, desc: 'Tasks by age and overdue status' },
                    ].map((tmpl) => (
                      <motion.button
                        key={tmpl.id}
                        whileHover={{ y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="neon-card group flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-all duration-200"
                      >
                        <div className="bg-brand-500/10 text-brand-500 rounded-xl p-2.5 transition-transform duration-200 group-hover:scale-110">
                          <tmpl.icon className="h-5 w-5" />
                        </div>
                        <span className="text-surface-700 text-sm font-medium">{tmpl.label}</span>
                        <span className="text-surface-500 text-[10px]">{tmpl.desc}</span>
                      </motion.button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Configuration & export */}
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Download className="text-surface-400 h-4 w-4" />
                    Generate Report
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center gap-4 py-6 text-center">
                    <div className="border-surface-300/20 bg-surface-100/50 flex h-14 w-14 items-center justify-center rounded-2xl border">
                      <FileText className="text-surface-400 h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-surface-700 text-sm font-medium">
                        Select a template and export format
                      </p>
                      <p className="text-surface-500 mt-1 text-xs">
                        Choose from pre-built templates above, then export as CSV
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="default" size="sm" className="h-9 rounded-lg px-4 text-xs">
                            <Download className="mr-1.5 h-4 w-4" />
                            Export Report
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" sideOffset={6}>
                          <DropdownMenuLabel>Choose format</DropdownMenuLabel>
                          {['tasks', 'projects', 'users'].map((type) => (
                            <DropdownMenuItem key={type} onClick={() => handleExport(type)}>
                              <FileText className="h-4 w-4" />
                              {type.charAt(0).toUpperCase() + type.slice(1)} — CSV
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateSnapshot}
                        disabled={generating}
                        className="h-9 rounded-lg px-4 text-xs"
                      >
                        {generating ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="mr-1.5 h-4 w-4" />
                        )}
                        {generating ? 'Capturing...' : 'Take Snapshot'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}

        {activeTab === 'time' && (
          <motion.div
            key="time"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Card className="neon-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Timer className="text-surface-400 h-4 w-4" />
                  Time Tracking
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="border-surface-300/20 flex gap-0.5 rounded-xl border p-0.5">
                    {(['week', 'month', 'quarter'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setTimePeriod(p)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                          timePeriod === p
                            ? 'bg-brand-500 text-white shadow-sm'
                            : 'text-surface-500 hover:text-surface-700 hover:bg-surface-200/50 '
                        }`}
                      >
                        {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Quarter'}
                      </button>
                    ))}
                  </div>
                  <kbd className="bg-surface-200/50 text-surface-500 hidden rounded-md px-1.5 py-0.5 text-[10px] font-mono md:inline-block">
                    1-2-3
                  </kbd>
                </div>
              </CardHeader>
              <CardContent>
                {timeReportLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="text-surface-400 h-6 w-6 animate-spin" />
                  </div>
                ) : timeReport && timeReport.totalHours > 0 ? (
                  <div className="space-y-6">
                    {/* Summary row */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {[
                        { label: 'Total Hours', value: timeReport.totalHours },
                        { label: 'Entries', value: timeReport.entryCount },
                        { label: 'Avg Session', value: `${timeReport.avgSessionMinutes}m` },
                        { label: 'Active Days', value: timeReport.dailyHours.length },
                      ].map((stat) => (
                        <motion.div
                          key={stat.label}
                          whileHover={{ y: -1 }}
                          className="neon-card hover:bg-surface-200/30 rounded-xl p-3 transition-all duration-200"
                        >
                          <p className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                            {stat.label}
                          </p>
                          <p className="text-surface-900 mt-1 text-xl font-bold tabular-nums">
                            {stat.value}
                          </p>
                        </motion.div>
                      ))}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Daily hours chart */}
                      <div className="neon-card rounded-xl p-4">
                        <p className="text-surface-500 mb-3 text-xs font-semibold uppercase tracking-wider">
                          Hours by Day
                        </p>
                        <div className="space-y-1.5">
                          {timeReport.dailyHours.slice(-14).map((day, idx) => {
                            const maxHours = Math.max(
                              ...timeReport.dailyHours.map((d) => d.hours),
                              1,
                            );
                            const pct = Math.round((day.hours / maxHours) * 100);
                            const date = new Date(day.date + 'T00:00:00');
                            const label = date.toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            });
                            return (
                              <motion.div
                                key={day.date}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.03 }}
                                className="flex items-center gap-2"
                              >
                                <span className="text-surface-500 w-20 shrink-0 text-[10px] font-medium">
                                  {label}
                                </span>
                                <div className="bg-surface-200/50 flex-1 overflow-hidden rounded-full h-4">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{
                                      duration: 0.6,
                                      ease: 'easeOut',
                                      delay: idx * 0.03,
                                    }}
                                    className="bg-brand-500 h-full rounded-full"
                                  />
                                </div>
                                <span className="text-surface-600 w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                                  {day.hours}h
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Top users */}
                      <div className="neon-card rounded-xl p-4">
                        <p className="text-surface-500 mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                          <UserCheck className="h-3 w-3" />
                          Top Users by Hours
                        </p>
                        <div className="space-y-2">
                          {timeReport.byUser.slice(0, 8).map((u, idx) => {
                            const maxUserHours = Math.max(
                              ...timeReport.byUser.map((x) => x.hours),
                              1,
                            );
                            const pct = Math.round((u.hours / maxUserHours) * 100);
                            return (
                              <motion.div
                                key={u.userId}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.04 }}
                                className="flex items-center gap-2"
                              >
                                <div className="bg-surface-300/20 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-surface-500">
                                  {u.userName.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-surface-700 w-24 truncate text-sm font-medium">
                                  {u.userName}
                                </span>
                                <div className="bg-surface-200/50 flex-1 overflow-hidden rounded-full h-3">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{
                                      duration: 0.6,
                                      ease: 'easeOut',
                                      delay: idx * 0.04,
                                    }}
                                    className="bg-purple-500 h-full rounded-full"
                                  />
                                </div>
                                <span className="text-surface-600 w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                                  {u.hours}h
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Top tasks by time */}
                    {timeReport.topTasks.length > 0 && (
                      <div className="border-surface-300/20 rounded-xl border p-4">
                        <p className="text-surface-500 mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                          <ListTodo className="h-3 w-3" />
                          Top Tasks by Time
                        </p>
                        <div className="space-y-1">
                          {timeReport.topTasks.map((t, idx) => (
                            <motion.div
                              key={t.taskId}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: idx * 0.03 }}
                              className="hover:bg-surface-200/50 flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors"
                            >
                              <Link
                                href={`/tasks/${t.taskId}`}
                                className="text-surface-700 hover:text-brand-500 truncate text-sm font-medium transition-colors"
                              >
                                {t.title}
                              </Link>
                              <div className="flex shrink-0 items-center gap-3">
                                <span className="text-surface-500 text-xs">{t.entryCount} entries</span>
                                <Badge variant="default" size="sm">{t.hours}h</Badge>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Top projects by time */}
                    {timeReport.byProject.length > 0 && (
                      <div className="border-surface-300/20 rounded-xl border p-4">
                        <p className="text-surface-500 mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                          <FolderKanban className="h-3 w-3" />
                          Hours by Project
                        </p>
                        <div className="space-y-1">
                          {timeReport.byProject.map((p, idx) => (
                            <motion.div
                              key={p.projectId}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: idx * 0.03 }}
                              className="flex items-center justify-between rounded-lg px-2 py-1.5"
                            >
                              <span className="text-surface-700 truncate text-sm font-medium">
                                {p.projectName}
                              </span>
                              <div className="flex shrink-0 items-center gap-3">
                                <span className="text-surface-500 text-xs">
                                  {p.entryCount} entries
                                </span>
                                <Badge variant="default" size="sm">{p.hours}h</Badge>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-12 text-center">
                    <div className="neon-card mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                      <Timer className="text-surface-400 h-6 w-6" />
                    </div>
                    <p className="text-surface-700 text-sm font-medium">
                      No time data for this period
                    </p>
                    <p className="text-surface-500 mt-1 text-xs">
                      Start tracking time on tasks to see reports
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
