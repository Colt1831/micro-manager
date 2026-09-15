'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Camera,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Loader2,
  BarChart3,
  Users,
  FolderKanban,
  ListTodo,
  Flag,
  Sparkles,
  UserCheck,
  Layers,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Types ──────────────────────────────────────────────────

export interface SnapshotDetail {
  id: string;
  snapshotDate: string;
  snapshotType: string;
  label: string | null;
  summary: Record<string, unknown> | null;
  snapshotData: Record<string, unknown> | null;
  generatedBy: string;
  createdAt: string;
}

interface SnapshotData {
  timestamp: string;
  generatedBy: string;
  organizationId: string;
  date: string;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    createdThisPeriod: number;
    completedThisPeriod: number;
    completionRate: number;
  };
  projects: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
  };
  users: {
    total: number;
    active: number;
  };
  teams: {
    total: number;
  };
}

interface Summary {
  totalTasks: number;
  completedCount: number;
  overdueCount: number;
  activeProjects: number;
  totalUsers: number;
  completionRate: number;
  aiSummary?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  completed: 'bg-green-500',
  closed: 'bg-emerald-500',
  blocked: 'bg-red-500',
  cancelled: 'bg-surface-400',
  archived: 'bg-surface-500',
  unknown: 'bg-surface-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
  none: 'bg-surface-300',
};

const PROJECT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  planning: 'bg-blue-400',
  on_hold: 'bg-amber-400',
  completed: 'bg-emerald-500',
  cancelled: 'bg-surface-400',
  archived: 'bg-surface-500',
  unknown: 'bg-surface-300',
};

function statusLabel(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function maxValue(dist: Record<string, number>): number {
  return Math.max(...Object.values(dist), 1);
}

function getColor(map: Record<string, string>, key: string, fallback: string): string {
  return map[key] ?? fallback;
}

// ─── Bar Row ────────────────────────────────────────────────

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-surface-600 w-24 shrink-0 text-[11px] font-medium capitalize">
        {label}
      </span>
      <div className="bg-surface-200/50 flex-1 overflow-hidden rounded-full h-5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`${color} h-full rounded-full`}
        />
      </div>
      <span className="text-surface-700 w-10 shrink-0 text-right text-xs font-bold tabular-nums">
        {value}
      </span>
    </div>
  );
}

// ─── Sparkline ─────────────────────────────────────────────

const SPARK_W = 80;
const SPARK_H = 24;
const SPARK_PAD = 2;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const w = SPARK_W - SPARK_PAD * 2;
  const h = SPARK_H - SPARK_PAD * 2;

  const points = values
    .map((v, i) => {
      const x = SPARK_PAD + (i / (values.length - 1)) * w;
      const y = SPARK_PAD + h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={points.split(' ').pop()!.split(',')[0]!} cy={points.split(' ').pop()!.split(',')[1]!} r="2" fill={color} />
    </svg>
  );
}

// ─── Stat Card ──────────────────────────────────────────────

const ICON_BG_CLASSES: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400',
  green: 'bg-green-500/10 text-green-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  orange: 'bg-orange-500/10 text-orange-400',
  amber: 'bg-amber-500/10 text-amber-400',
  teal: 'bg-teal-500/10 text-teal-400',
  cyan: 'bg-cyan-500/10 text-cyan-400',
  purple: 'bg-purple-500/10 text-purple-400',
  violet: 'bg-violet-500/10 text-violet-400',
  brand: 'bg-brand-500/10 text-brand-400',
};

function getColorName(gradient: string): string {
  return gradient.split('-')[1] ?? 'brand';
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  const colorName = getColorName(color);
  const iconClass = ICON_BG_CLASSES[colorName] ?? 'bg-brand-500/10 text-brand-400';

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="neon-card group relative overflow-hidden rounded-xl p-4 transition-all duration-200"
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${color} opacity-60`} />
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
            {label}
          </p>
          <p className="text-surface-900 text-xl font-bold tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={`rounded-lg p-2 ${iconClass} transition-all duration-300 group-hover:scale-110`}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Related-snapshot derivation ────────────────────────────

// The listing is ordered DESC by date (most recent first), so index+1 is the
// chronologically previous snapshot, and the current snapshot plus the next 6
// (indices idx..idx+6) are the last 7 snapshots for the trend sparklines.
function deriveRelated(
  id: string,
  all: SnapshotDetail[],
): { previous: SnapshotDetail | null; trend: SnapshotDetail[] } {
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return { previous: null, trend: [] };
  const previous = idx < all.length - 1 ? (all[idx + 1] ?? null) : null;
  const trend = all.slice(idx, idx + 7);
  return { previous, trend };
}

// ─── Main Page ──────────────────────────────────────────────

interface SnapshotDetailClientProps {
  /** Server-rendered snapshot; null means the server load failed/not-found and the client should fetch. */
  initialSnapshot: SnapshotDetail | null;
  /** Server-rendered recent EOD snapshots list, used to derive the previous snapshot + trend. */
  initialSnapshots: SnapshotDetail[];
}

export function SnapshotDetailClient({ initialSnapshot, initialSnapshots }: SnapshotDetailClientProps) {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id as string;

  // When the server provided the snapshot, first paint already has real content.
  const [hadInitialData] = useState(() => initialSnapshot !== null);
  const [loading, setLoading] = useState(initialSnapshot === null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDetail | null>(initialSnapshot);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedAi, setExpandedAi] = useState(false);
  const [previousSnapshot, setPreviousSnapshot] = useState<SnapshotDetail | null>(
    () => deriveRelated(id, initialSnapshots).previous,
  );
  const [trendSnapshots, setTrendSnapshots] = useState<SnapshotDetail[]>(
    () => deriveRelated(id, initialSnapshots).trend,
  );

  // ── Fetch snapshot (client fallback) ───────────────────
  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapRes, listRes] = await Promise.all([
        fetch(`/api/reports/snapshots/${id}`),
        fetch('/api/reports/snapshots?limit=50&type=eod'),
      ]);

      if (!snapRes.ok) {
        if (snapRes.status === 404) throw new Error('Snapshot not found');
        throw new Error('Failed to load snapshot');
      }
      const snapData = await snapRes.json();
      setSnapshot(snapData.snapshot);

      if (listRes.ok) {
        const listData = await listRes.json();
        const { previous, trend } = deriveRelated(id, listData.snapshots ?? []);
        setPreviousSnapshot(previous);
        setTrendSnapshots(trend);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchSnapshot();
    });
  }, [hadInitialData, fetchSnapshot]);

  // ── Export CSV ─────────────────────────────────────────
  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/reports/snapshots/${id}/export`, { method: 'GET' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? 'Failed to export snapshot');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot-${snapshot?.snapshotDate ?? id.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: 'Export complete',
        description: 'Snapshot exported as CSV.',
      });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setExporting(false);
    }
  }

  // ── Generate AI summary ─────────────────────────────────
  async function handleGenerateAi() {
    setGeneratingAi(true);
    try {
      const res = await fetch(`/api/reports/snapshots/${id}/ai-summary`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? 'Failed to generate AI summary');
      }
      const data = await res.json();
      setSnapshot((prev) =>
        prev ? { ...prev, summary: data.summary as Record<string, unknown> } : prev,
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
      setGeneratingAi(false);
    }
  }

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="shimmer h-8 w-48 rounded-xl" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="neon-card rounded-2xl p-5">
              <div className="shimmer h-3 w-16 rounded-lg" />
              <div className="shimmer mt-3 h-8 w-12 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="neon-card rounded-2xl p-6">
          <div className="shimmer h-4 w-36 rounded-lg" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="shimmer h-8 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────
  if (error || !snapshot) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
        <div className="neon-card mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
          <AlertTriangle className="text-surface-400 h-8 w-8" />
        </div>
        <h2 className="text-surface-900 text-lg font-semibold">
          {error ?? 'Snapshot not found'}
        </h2>
        <p className="text-surface-500 mt-1 text-sm">
          The snapshot may have been deleted or you may not have access.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6 h-9 rounded-lg px-4 text-xs"
          onClick={() => router.push('/reports')}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Reports
        </Button>
      </div>
    );
  }

  // ── Parse data ───────────────────────────────────────────
  const summary = snapshot.summary as Summary | null;
  const snapshotData = snapshot.snapshotData as SnapshotData | null;
  const aiSummary = summary?.aiSummary ?? null;
  const isLongAi = (aiSummary?.length ?? 0) > 200;

  // Task status distribution
  const taskByStatus = snapshotData?.tasks.byStatus ?? {};
  const taskByPriority = snapshotData?.tasks.byPriority ?? {};
  const projectByStatus = snapshotData?.projects.byStatus ?? {};

  const taskStatusMax = maxValue(taskByStatus);
  const taskPriorityMax = maxValue(taskByPriority);
  const projectStatusMax = maxValue(projectByStatus);

  const createdDate = new Date(snapshot.createdAt);

  return (
    <motion.div
      initial={hadInitialData ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push('/reports')}
          className="text-surface-400 hover:text-surface-600 rounded-lg p-1.5 transition-colors"
          aria-label="Back to reports"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-surface-900 text-xl font-bold tracking-tight">
              {snapshot.label ?? `Snapshot — ${snapshot.snapshotDate}`}
            </h1>
            <Badge variant="default" size="sm" className="text-[10px]">
              {snapshot.snapshotType.toUpperCase()}
            </Badge>
          </div>
          <p className="text-surface-500 mt-0.5 text-sm">
            Captured{' '}
            {createdDate.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
        >
          {exporting ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      {/* ── Summary KPI Cards ─────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard
            icon={<ListTodo className="h-4 w-4" />}
            label="Total Tasks"
            value={summary.totalTasks}
            color="from-blue-500 to-blue-400"
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Completed"
            value={summary.completedCount}
            color="from-green-500 to-emerald-400"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Overdue"
            value={summary.overdueCount}
            color="from-orange-500 to-amber-400"
          />
          <StatCard
            icon={<FolderKanban className="h-4 w-4" />}
            label="Active Projects"
            value={summary.activeProjects}
            color="from-teal-500 to-cyan-400"
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Team Members"
            value={summary.totalUsers}
            color="from-purple-500 to-violet-400"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Completion Rate"
            value={`${summary.completionRate}%`}
            color="from-brand-500 to-brand-400"
          />
        </div>
      )}

      {/* ── AI Summary Card ───────────────────────────────── */}
      <motion.div
        initial={hadInitialData ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-amber-400 h-4 w-4" />
              AI Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {aiSummary ? (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <p className="text-surface-700 text-sm leading-relaxed whitespace-pre-line">
                    {isLongAi && !expandedAi ? aiSummary.slice(0, 200) + '…' : aiSummary}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateAi}
                    disabled={generatingAi}
                    className="h-7 shrink-0 rounded-lg px-2 text-[10px]"
                  >
                    {generatingAi ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {generatingAi ? 'Regenerating...' : 'Regenerate'}
                  </Button>
                </div>
                {isLongAi && (
                  <button
                    onClick={() => setExpandedAi(!expandedAi)}
                    className="text-amber-500 hover:text-amber-400 mt-2 text-xs font-medium transition-colors"
                  >
                    {expandedAi ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-surface-500 text-sm">
                  No AI summary yet. Generate one to get a concise overview of this snapshot.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAi}
                  disabled={generatingAi}
                  className="h-8 rounded-lg px-3 text-xs"
                >
                  {generatingAi ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {generatingAi ? 'Generating...' : 'Generate'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Task Breakdown ────────────────────────────────── */}
      {snapshotData && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Task Status */}
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="text-blue-400 h-4 w-4" />
                  Task Status Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(taskByStatus).length > 0 ? (
                    Object.entries(taskByStatus).map(([status, count]) => (
                      <BarRow
                        key={status}
                        label={statusLabel(status)}
                        value={count}
                        max={taskStatusMax}
                        color={getColor(STATUS_COLORS, status, 'bg-surface-300')}
                      />
                    ))
                  ) : (
                    <p className="text-surface-500 py-4 text-center text-sm">No task data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Task Priority */}
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flag className="text-orange-400 h-4 w-4" />
                  Task Priority Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(taskByPriority).length > 0 ? (
                    Object.entries(taskByPriority).map(([priority, count]) => (
                      <BarRow
                        key={priority}
                        label={statusLabel(priority)}
                        value={count}
                        max={taskPriorityMax}
                        color={getColor(PRIORITY_COLORS, priority, 'bg-surface-300')}
                      />
                    ))
                  ) : (
                    <p className="text-surface-500 py-4 text-center text-sm">No priority data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      {/* ── Task Activity & Project Stats ─────────────────── */}
      {snapshotData && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Task Activity */}
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListTodo className="text-brand-400 h-4 w-4" />
                  Task Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-2">
                    <span className="text-surface-600 text-xs font-medium">
                      Created Today
                    </span>
                    <span className="text-surface-900 text-sm font-bold tabular-nums">
                      {snapshotData.tasks.createdThisPeriod}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-2">
                    <span className="text-surface-600 text-xs font-medium">
                      Completed Today
                    </span>
                    <span className="text-green-500 text-sm font-bold tabular-nums">
                      {snapshotData.tasks.completedThisPeriod}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-2">
                    <span className="text-surface-600 text-xs font-medium">
                      Overdue
                    </span>
                    <span className="text-orange-500 text-sm font-bold tabular-nums">
                      {snapshotData.tasks.overdue}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-600 text-xs font-medium">
                      Completion Rate
                    </span>
                    <span className="text-brand-500 text-sm font-bold tabular-nums">
                      {snapshotData.tasks.completionRate}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Project Status */}
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderKanban className="text-teal-400 h-4 w-4" />
                  Project Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-2 mb-3">
                    <span className="text-surface-600 text-xs font-medium">
                      Total Projects
                    </span>
                    <span className="text-surface-900 text-sm font-bold tabular-nums">
                      {snapshotData.projects.total}
                    </span>
                  </div>
                  {Object.entries(projectByStatus).length > 0 ? (
                    Object.entries(projectByStatus).map(([status, count]) => (
                      <BarRow
                        key={status}
                        label={statusLabel(status)}
                        value={count}
                        max={projectStatusMax}
                        color={getColor(PROJECT_STATUS_COLORS, status, 'bg-surface-300')}
                      />
                    ))
                  ) : (
                    <p className="text-surface-500 py-4 text-center text-sm">No project data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Users & Teams */}
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="text-purple-400 h-4 w-4" />
                  People & Teams
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="bg-purple-500/10 text-purple-400 flex h-8 w-8 items-center justify-center rounded-lg">
                        <Users className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-surface-600 text-[10px] font-semibold uppercase tracking-wider">
                          Total Users
                        </p>
                        <p className="text-surface-900 text-sm font-bold tabular-nums">
                          {snapshotData.users.total}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-b border-surface-200/50 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="bg-green-500/10 text-green-400 flex h-8 w-8 items-center justify-center rounded-lg">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-surface-600 text-[10px] font-semibold uppercase tracking-wider">
                          Active Users
                        </p>
                        <p className="text-surface-900 text-sm font-bold tabular-nums">
                          {snapshotData.users.active}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="bg-cyan-500/10 text-cyan-400 flex h-8 w-8 items-center justify-center rounded-lg">
                        <Layers className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-surface-600 text-[10px] font-semibold uppercase tracking-wider">
                          Teams
                        </p>
                        <p className="text-surface-900 text-sm font-bold tabular-nums">
                          {snapshotData.teams.total}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      {/* ── Daily Comparison ────────────────────────────── */}
      {previousSnapshot && summary && trendSnapshots.length >= 2 && (() => {
        const prevSummary = previousSnapshot.summary as Summary | null;
        if (!prevSummary) return null;

        // Extract trend values from trend snapshots (ordered DESC — most recent first)
        function extractTrend(key: keyof Summary): number[] {
          return trendSnapshots
            .map((s) => {
              const sm = s.summary as Summary | null;
              return sm ? (sm[key] as number) ?? 0 : 0;
            })
            .reverse(); // Reverse so oldest→newest flows left→right
        }

        const SPARKLINE_COLORS: Record<string, string> = {
          totalTasks: '#60a5fa',
          completedCount: '#34d399',
          overdueCount: '#f87171',
          completionRate: '#a78bfa',
          activeProjects: '#14b8a6',
          totalUsers: '#818cf8',
        };

        const metrics: Array<{
          label: string;
          current: number;
          previous: number;
          format?: 'number' | 'percent';
          invert?: boolean;
          trendKey: keyof Summary;
        }> = [
          { label: 'Total Tasks', current: summary.totalTasks, previous: prevSummary.totalTasks, trendKey: 'totalTasks' },
          { label: 'Completed', current: summary.completedCount, previous: prevSummary.completedCount, trendKey: 'completedCount' },
          { label: 'Overdue', current: summary.overdueCount, previous: prevSummary.overdueCount, invert: true, trendKey: 'overdueCount' },
          { label: 'Completion Rate', current: summary.completionRate, previous: prevSummary.completionRate, format: 'percent', trendKey: 'completionRate' },
          { label: 'Active Projects', current: summary.activeProjects, previous: prevSummary.activeProjects, trendKey: 'activeProjects' },
          { label: 'Team Members', current: summary.totalUsers, previous: prevSummary.totalUsers, trendKey: 'totalUsers' },
        ];

        return (
          <motion.div
            initial={hadInitialData ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="text-brand-400 h-4 w-4" />
                  vs Previous Snapshot
                  <span className="text-surface-400 ml-1 text-[10px] font-normal">
                    —{' '}
                    {new Date(previousSnapshot.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {metrics.map((m) => {
                    const delta = m.current - m.previous;
                    const isPositive = m.invert ? delta < 0 : delta > 0;
                    const isNeutral = delta === 0;
                    const absDelta = Math.abs(delta);
                    const displayDelta =
                      m.format === 'percent'
                        ? `${delta > 0 ? '+' : ''}${delta}pp`
                        : `${delta > 0 ? '+' : ''}${absDelta}`;
                    const trendValues = extractTrend(m.trendKey);
                    const sparkColor = SPARKLINE_COLORS[m.trendKey] ?? '#60a5fa';

                    return (
                      <motion.div
                        key={m.label}
                        whileHover={{ y: -1 }}
                        className="neon-card group relative overflow-hidden rounded-xl border p-3 transition-all duration-200"
                      >
                        <div className="flex items-start justify-between">
                          <p className="text-surface-500 text-[9px] font-semibold uppercase tracking-wider">
                            {m.label}
                          </p>
                          {trendValues.length >= 2 && (
                            <Sparkline values={trendValues} color={sparkColor} />
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-surface-900 text-lg font-bold tabular-nums">
                            {m.current}
                            {m.format === 'percent' && '%'}
                          </span>
                          {!isNeutral && (
                            <span
                              className={`flex items-center gap-0.5 text-[11px] font-medium ${
                                isPositive ? 'text-green-500' : 'text-red-500'
                              }`}
                            >
                              {isPositive ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {displayDelta}
                            </span>
                          )}
                        </div>
                        <p className="text-surface-400 mt-0.5 text-[9px]">
                          Previous: {m.previous}
                          {m.format === 'percent' && '%'}
                        </p>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })()}

      {/* ── Metadata ──────────────────────────────────────── */}
      <motion.div
        initial={hadInitialData ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-center gap-2 text-[10px] text-surface-400"
      >
        <Camera className="h-3 w-3" />
        <span>
          Snapshot {snapshot.id.slice(0, 8)} —{' '}
          {createdDate.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </motion.div>
    </motion.div>
  );
}
