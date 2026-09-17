'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Plus,
  X,
  AlertCircle,
  Edit3,
  Trash2,
  Milestone,
  Calendar,
  Flag,
  ListTodo,
  CheckCircle2,
  Save,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

export interface MilestoneData {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: string | null;
  name: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  completedDate: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  _taskCount: number;
  _completedTaskCount: number;
}

// ─── Constants ──────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; barColor: string }> = {
  pending: { label: 'Pending', color: 'text-amber-500 bg-amber-500/10', barColor: 'bg-amber-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-500 bg-blue-500/10', barColor: 'bg-blue-500' },
  completed: { label: 'Completed', color: 'text-success bg-success/10', barColor: 'bg-success' },
  delayed: { label: 'Delayed', color: 'text-error bg-error/10', barColor: 'bg-error' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, color: 'text-surface-500 bg-surface-500/10', barColor: 'bg-surface-400' };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getProgress(milestone: MilestoneData): number {
  if (milestone._taskCount === 0) return milestone.status === 'completed' ? 100 : 0;
  return Math.round((milestone._completedTaskCount / milestone._taskCount) * 100);
}

function getDateRange(milestones: MilestoneData[]): { start: Date; end: Date } {
  const now = new Date();
  let earliest = new Date(now.getFullYear(), now.getMonth(), 1);
  let latest = new Date(now.getFullYear(), now.getMonth() + 3, 1);

  for (const m of milestones) {
    if (m.dueDate) {
      const d = new Date(m.dueDate);
      if (d < earliest) earliest = d;
      if (d > latest) latest = d;
    }
  }

  // Add padding
  earliest.setMonth(earliest.getMonth() - 1);
  latest.setMonth(latest.getMonth() + 1);

  return { start: earliest, end: latest };
}

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ═══════════════════════════════════════════════════════════════
//  MILESTONES PAGE
// ═══════════════════════════════════════════════════════════════

export interface MilestonesClientProps {
  /** Server-seeded milestones; null means the server load failed and the client fetches on mount. */
  initialMilestones: MilestoneData[] | null;
}

export function MilestonesClient({ initialMilestones }: MilestonesClientProps) {
  // When the server seeded the list, the first paint already has real content.
  const [hadInitialData] = useState(() => initialMilestones !== null);
  const [milestones, setMilestones] = useState<MilestoneData[]>(initialMilestones ?? []);
  const [loading, setLoading] = useState(initialMilestones === null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ projectId: '', name: '', description: '', dueDate: '', status: 'pending' as string });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Fetch milestones ────────────────────────────────────

  const fetchMilestones = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/milestones${params}`);
      if (!res.ok) throw new Error('Failed to load milestones');
      const data = await res.json();
      setMilestones(data.milestones ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load milestones');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects?limit=100');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects?.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })) ?? []);
      }
    } catch { /* */ }
  }, []);

   
  // Skip only the initial milestones fetch when the server already seeded the
  // list; status-filter changes still refetch. Projects (create/edit form data,
  // not LCP content) always load from the client.
  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (!skipInitialFetch.current) fetchMilestones();
    skipInitialFetch.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProjects();
  }, [fetchMilestones, fetchProjects]);

  // ── Create/Edit form ────────────────────────────────────

  const openCreateForm = () => {
    setEditingId(null);
    setForm({ projectId: projects[0]?.id ?? '', name: '', description: '', dueDate: '', status: 'pending' });
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (m: MilestoneData) => {
    setEditingId(m.id);
    setForm({
      projectId: m.projectId,
      name: m.name,
      description: m.description ?? '',
      dueDate: m.dueDate ?? '',
      status: m.status,
    });
    setFormError(null);
    setShowForm(true);
  };

  const saveMilestone = async () => {
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.projectId) { setFormError('Project is required'); return; }

    setSaving(true);
    setFormError(null);

    try {
      const url = editingId ? `/api/milestones?id=${editingId}` : '/api/milestones';
      const method = editingId ? 'PATCH' : 'POST';

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        dueDate: form.dueDate || undefined,
        status: form.status || undefined,
      };
      if (!editingId) body.projectId = form.projectId;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to save');
      }

      setShowForm(false);
      fetchMilestones();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save milestone');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────

  const deleteMilestone = async () => {
    if (!showDeleteConfirm) return;
    setDeletingId(showDeleteConfirm);
    try {
      const res = await fetch(`/api/milestones?id=${showDeleteConfirm}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setShowDeleteConfirm(null);
      fetchMilestones();
    } catch {
      setShowDeleteConfirm(null);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Date range for timeline ─────────────────────────────

  const dateRange = useMemo(() => getDateRange(milestones), [milestones]);

  const months = useMemo(() => {
    const result: Array<{ month: string; year: number; start: Date; days: number }> = [];
    const d = new Date(dateRange.start);
    while (d <= dateRange.end) {
      const year = d.getFullYear();
      const month = d.getMonth();
      const start = new Date(year, month, 1);
      const days = new Date(year, month + 1, 0).getDate();
      result.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        year,
        start,
        days,
      });
      d.setMonth(d.getMonth() + 1);
    }
    return result;
  }, [dateRange]);

  const totalDays = useMemo(() => {
    if (months.length === 0) return 30;
    const first = months[0]!.start;
    const last = new Date(months[months.length - 1]!.start);
    last.setMonth(last.getMonth() + 1);
    return Math.ceil((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  }, [months]);

  const getBarPosition = (dueDate: string | null) => {
    if (!dueDate) return { left: '0%', width: '0%' };
    const d = new Date(dueDate);
    const start = months[0]!.start;
    const diffMs = d.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const totalWeeks = totalDays / 7;
    const barWidth = Math.max(4, 100 / totalWeeks);
    const leftPct = Math.max(0, (diffDays / totalDays) * 100);
    return { left: `${leftPct}%`, width: `${barWidth}%` };
  };

  // ── Filtered milestones ────────────────────────────────

  const filteredMilestones = useMemo(() => {
    if (statusFilter === 'all') return milestones;
    return milestones.filter((m) => m.status === statusFilter);
  }, [milestones, statusFilter]);

  // ── Group by project for list view ──────────────────────

  const groupedByProject = useMemo(() => {
    const groups: Record<string, { projectName: string; items: MilestoneData[] }> = {};
    for (const m of filteredMilestones) {
      if (!groups[m.projectId]) {
        groups[m.projectId] = { projectName: m.projectName, items: [] };
      }
      groups[m.projectId]!.items.push(m);
    }
    return Object.entries(groups);
  }, [filteredMilestones]);

  // ── Render ──────────────────────────────────────────────

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
              <Milestone className="h-4 w-4 text-white" />
            </div>
          }
          title="Milestones"
          subtitle={`${milestones.length} milestone${milestones.length !== 1 ? 's' : ''} across ${groupedByProject.length} project${groupedByProject.length !== 1 ? 's' : ''}`}
          actions={
            <>
              <div className="bg-surface-200/60 inline-flex items-center gap-0.5 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={cn(
                    'rounded-md px-2 py-1 text-[10px] font-medium transition-all',
                    viewMode === 'timeline' ? 'bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-500',
                  )}
                >
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'rounded-md px-2 py-1 text-[10px] font-medium transition-all',
                    viewMode === 'list' ? 'bg-surface-300 text-surface-900 shadow-sm' : 'text-surface-500',
                  )}
                >
                  List
                </button>
              </div>
              <Button size="sm" onClick={openCreateForm} className="h-8 rounded-lg px-3 text-xs">
                <Plus className="mr-1 h-3.5 w-3.5" />
                New Milestone
              </Button>
            </>
          }
        />
      </motion.div>

      {/* Status filter */}
      <motion.div variants={itemVariants}>
        <div className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5">
          {[
            { value: 'all', label: 'All', count: milestones.length },
            { value: 'pending', label: 'Pending', count: milestones.filter((m) => m.status === 'pending').length },
            { value: 'in_progress', label: 'In Progress', count: milestones.filter((m) => m.status === 'in_progress').length },
            { value: 'completed', label: 'Completed', count: milestones.filter((m) => m.status === 'completed').length },
            { value: 'delayed', label: 'Delayed', count: milestones.filter((m) => m.status === 'delayed').length },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                statusFilter === tab.value
                  ? 'bg-surface-50 text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 ',
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]',
                  statusFilter === tab.value ? 'bg-brand-500/10 text-brand-500' : 'bg-surface-300/30 ',
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-24 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-12">
          <AlertCircle className="text-error mb-2 h-8 w-8" />
          <p className="text-error text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchMilestones}>Retry</Button>
        </div>
      ) : milestones.length === 0 ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center py-16">
          <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
            <Flag className="text-surface-400 h-7 w-7" />
          </div>
          <h3 className="text-surface-900 text-base font-semibold">No milestones yet</h3>
          <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
            Create milestones to track key dates and progress across your projects.
          </p>
          <Button onClick={openCreateForm} className="mt-5 h-8 rounded-xl px-3 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Your First Milestone
          </Button>
        </motion.div>
      ) : viewMode === 'timeline' ? (
        /* ── TIMELINE VIEW ── */
        <motion.div variants={itemVariants}>
          <div className="neon-card relative overflow-hidden rounded-2xl">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-600 opacity-40" />

            {/* Month headers */}
            <div className="overflow-x-auto" ref={scrollRef}>
              <div className="min-w-[600px]">
                <div className="border-surface-300/10 flex border-b">
                  <div className="w-48 shrink-0 border-r border-surface-300/10 px-4 py-3">
                    <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">Milestone</span>
                  </div>
                  {months.map((m, i) => (
                    <div
                      key={i}
                      className="flex-1 border-r border-surface-300/10 px-2 py-3 text-center last:border-r-0"
                      style={{ flexBasis: `${(m.days / totalDays) * 100}%` }}
                    >
                      <span className="text-surface-500 text-[10px] font-semibold">{m.month}</span>
                      <span className="text-surface-400 ml-1 text-[9px]">{m.year}</span>
                    </div>
                  ))}
                </div>

                {/* Milestone bars */}
                <div className="divide-surface-300/10 divide-y">
                  {filteredMilestones.map((m) => {
                    const config = getStatusConfig(m.status);
                    const bar = getBarPosition(m.dueDate);
                    const progress = getProgress(m);

                    return (
                      <div key={m.id} className="group flex transition-colors hover:bg-surface-200/30 ">
                        {/* Left label */}
                        <div className="w-48 shrink-0 border-r border-surface-300/10 px-4 py-3">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0">
                              <p className="text-surface-900 truncate text-sm font-medium">
                                {m.name}
                              </p>
                              <p className="text-surface-500 truncate text-xs">{m.projectName}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button onClick={() => openEditForm(m)} className="text-surface-400 hover:text-brand-500 rounded-lg p-1 transition-colors">
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <button onClick={() => setShowDeleteConfirm(m.id)} className="text-surface-400 hover:text-error rounded-lg p-1 transition-colors">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[9px] font-medium', config.color)}>
                              {config.label}
                            </span>
                            {m.dueDate && (
                              <span className="text-surface-400 flex items-center gap-0.5 text-[9px]">
                                <Calendar className="h-2.5 w-2.5" />
                                {formatDate(m.dueDate)}
                              </span>
                            )}
                          </div>
                          {/* Progress */}
                          {m._taskCount > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <div className="bg-surface-300/30 h-1 flex-1 overflow-hidden rounded-full">
                                <div
                                  className={cn('h-full rounded-full transition-all', config.barColor)}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-surface-400 text-[9px]">
                                {m._completedTaskCount}/{m._taskCount}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Gantt area */}
                        <div className="relative flex-1 px-2">
                          {months.map((month, mi) => (
                            <div
                              key={mi}
                              className="absolute inset-y-0 border-r border-surface-300/5 "
                              style={{ left: `${months.slice(0, mi).reduce((sum, m) => sum + (m.days / totalDays) * 100, 0)}%`, width: `${(month.days / totalDays) * 100}%` }}
                            />
                          ))}
                          {/* Today line */}
                          {(() => {
                            const now = new Date();
                            const start = months[0]!.start;
                            const diff = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                            const pct = (diff / totalDays) * 100;
                            return (
                              <div
                                className="absolute inset-y-0 w-px bg-error/50 z-10"
                                style={{ left: `${pct}%` }}
                                title="Today"
                              />
                            );
                          })()}
                          {/* Milestone bar */}
                          {m.dueDate && (
                            <div
                              className={cn(
                                'absolute top-1/2 -translate-y-1/2 h-6 rounded-md transition-all',
                                'group-hover:shadow-sm group-hover:scale-y-110',
                                config.barColor.replace('bg-', 'bg-/80 '),
                              )}
                              style={{
                                left: bar.left,
                                width: bar.width,
                                minWidth: '4px',
                                opacity: m.status === 'completed' ? 0.6 : 0.85,
                              }}
                            >
                              <div className="flex h-full items-center px-1">
                                <span className="truncate text-[8px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                  {formatDate(m.dueDate)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="border-surface-300/10 flex items-center justify-center gap-4 border-t px-4 py-2 text-[9px] text-surface-400">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <span key={key} className="flex items-center gap-1">
                  <span className={cn('inline-block h-2 w-2 rounded-full', cfg.barColor)} />
                  {cfg.label}
                </span>
              ))}
              {filteredMilestones.length > 0 && (
                <>
                  <span className="text-surface-300 ">·</span>
                  <span className="flex items-center gap-1">
                    <span className="bg-error/50 inline-block h-3 w-0.5" />
                    Today
                  </span>
                </>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        /* ── LIST VIEW ── */
        <motion.div variants={itemVariants} className="space-y-6">
          {groupedByProject.map(([projectId, group]) => (
            <div key={projectId}>
              <h3 className="text-surface-700 mb-3 flex items-center gap-2 text-sm font-semibold">
                <span className="bg-surface-200/50 flex h-6 w-6 items-center justify-center rounded-lg">
                  <Flag className="text-surface-500 h-3 w-3" />
                </span>
                {group.projectName}
                <span className="text-surface-400 font-normal text-xs">({group.items.length})</span>
              </h3>
              <div className="space-y-2">
                {group.items.map((m) => {
                  const config = getStatusConfig(m.status);
                  const progress = getProgress(m);
                  return (
                    <div
                      key={m.id}
                      className="neon-card group relative overflow-hidden rounded-xl transition-all"
                    >
                      <div className={cn('absolute left-0 top-0 bottom-0 w-1', config.barColor)} />
                      <div className="p-4 pl-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', config.color)}>
                              <Flag className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-surface-900 text-sm font-semibold">{m.name}</h4>
                                <Badge variant={m.status === 'completed' ? 'success' : m.status === 'delayed' ? 'danger' : 'default'} size="sm" className="px-1.5 py-0 text-[9px]">
                                  {config.label}
                                </Badge>
                              </div>
                              {m.description && (
                                <p className="text-surface-500 mt-0.5 line-clamp-1 text-xs">{m.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-3">
                                <span className="text-surface-400 flex items-center gap-1 text-[10px]">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(m.dueDate)}
                                </span>
                                {m._taskCount > 0 && (
                                  <span className="text-surface-400 flex items-center gap-1 text-[10px]">
                                    <ListTodo className="h-3 w-3" />
                                    {m._completedTaskCount}/{m._taskCount} tasks
                                  </span>
                                )}
                                {m.completedDate && (
                                  <span className="text-surface-400 flex items-center gap-1 text-[10px]">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Completed {formatDate(m.completedDate)}
                                  </span>
                                )}
                              </div>
                              {m._taskCount > 0 && (
                                <div className="mt-2 flex items-center gap-2">
                                  <div className="bg-surface-300/30 h-1.5 w-32 overflow-hidden rounded-full">
                                    <div className={cn('h-full rounded-full transition-all', config.barColor)} style={{ width: `${progress}%` }} />
                                  </div>
                                  <span className="text-surface-500 text-[10px]">{progress}%</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => openEditForm(m)} className="text-surface-400 hover:text-brand-500 hover:bg-brand-500/10 rounded-lg p-1.5 transition-all">
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setShowDeleteConfirm(m.id)} className="text-surface-400 hover:text-error hover:bg-error/10 rounded-lg p-1.5 transition-all">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Create/Edit Form Dialog */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-10"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-lg rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">
                  {editingId ? 'Edit Milestone' : 'New Milestone'}
                </h3>
                <button onClick={() => setShowForm(false)} className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Project */}
                {!editingId && (
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Project</label>
                    <select
                      value={form.projectId}
                      onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    >
                      <option value="">Select project...</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., MVP Launch"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Optional description"
                    rows={2}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Due Date */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Status */}
                {editingId && (
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="delayed">Delayed</option>
                    </select>
                  </div>
                )}

                {formError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-surface-300/10 pt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="h-8 rounded-lg px-3 text-xs">Cancel</Button>
                  <Button onClick={saveMilestone} disabled={saving} size="sm" className="h-8 rounded-lg px-3 text-xs">
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-sm rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
            >
              <h3 className="text-surface-900 text-lg font-semibold">Delete Milestone</h3>
              <p className="text-surface-500 mt-2 text-sm">Are you sure? This action cannot be undone.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(null)} className="rounded-lg">Cancel</Button>
                <Button onClick={deleteMilestone} disabled={deletingId === showDeleteConfirm} className="rounded-lg bg-red-500 hover:bg-red-600 text-white">
                  {deletingId === showDeleteConfirm ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                  Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
