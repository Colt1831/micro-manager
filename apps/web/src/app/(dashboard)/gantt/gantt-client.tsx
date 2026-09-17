'use client';

import { useEffect, useState, useCallback, useRef, useMemo, startTransition } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  GripHorizontal,
  CalendarDays,
  Diamond,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────

export interface GanttProject {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progress: number | null;
  ownerId: string | null;
}

export interface GanttMilestone {
  id: string;
  projectId: string;
  name: string;
  status: string;
  dueDate: string | null;
  sortOrder: number | null;
}

export interface GanttTask {
  id: string;
  title: string;
  projectId: string | null;
  milestoneId: string | null;
  status: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  estimatedHours: string | null;
}

interface TimelineItem {
  id: string;
  type: 'project' | 'milestone' | 'task';
  parentId: string | null;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progress: number | null;
  priority: string | null;
}

// ─── Constants ──────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: '#6366f1', completed: '#22c55e', on_hold: '#f59e0b',
  draft: '#94a3b8', cancelled: '#ef4444', archived: '#6b7280',
  open: '#3b82f6', in_progress: '#f59e0b', blocked: '#ef4444',
  pending: '#94a3b8', done: '#22c55e',
};

const STATUS_BG: Record<string, string> = {
  active: 'bg-indigo-500', completed: 'bg-emerald-500', on_hold: 'bg-amber-500',
  draft: 'bg-slate-400', cancelled: 'bg-red-500', archived: 'bg-gray-500',
  open: 'bg-blue-500', in_progress: 'bg-amber-500', blocked: 'bg-red-500',
  pending: 'bg-slate-400', done: 'bg-emerald-500',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#6366f1';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ─── Animation variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } },
};

// ─── Main Page ──────────────────────────────────────────────

export interface GanttClientProps {
  /** Server-seeded projects; null means the server load failed and the client fetches on mount. */
  initialProjects: GanttProject[] | null;
  initialMilestones: GanttMilestone[];
  initialTasks: GanttTask[];
  /** Server render time (ms) — keeps the timeline range + today marker identical between SSR and hydration. */
  serverNow: number;
}

export function GanttClient({
  initialProjects,
  initialMilestones,
  initialTasks,
  serverNow,
}: GanttClientProps) {
  const [hadInitialData] = useState(() => initialProjects !== null);
  const [projects, setProjects] = useState<GanttProject[]>(initialProjects ?? []);
  const [milestones, setMilestones] = useState<GanttMilestone[]>(initialMilestones);
  const [tasks, setTasks] = useState<GanttTask[]>(initialTasks);
  const [loading, setLoading] = useState(initialProjects === null);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set((initialProjects ?? []).map((p) => p.id)),
  );
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState<{
    id: string; type: string; startX: number; origStart: string | null; origEnd: string | null;
  } | null>(null);
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const dragStartOffsetRef = useRef(0);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/gantt/data');
      if (!res.ok) throw new Error('Failed to load Gantt data');
      const data = await res.json();
      setProjects(data.projects ?? []);
      setMilestones(data.milestones ?? []);
      setTasks(data.tasks ?? []);
      setExpandedProjects(new Set((data.projects ?? []).map((p: GanttProject) => p.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    startTransition(() => { fetchData(); });
  }, [fetchData]);

  // ── Timeline range calculation ──────────────────────────

  const { rangeStart, totalDays, monthMarkers } = useMemo(() => {
    const dates: Date[] = [new Date(serverNow)];
    for (const p of projects) {
      if (p.startDate) dates.push(new Date(p.startDate));
      if (p.endDate) dates.push(new Date(p.endDate));
    }
    for (const m of milestones) {
      if (m.dueDate) dates.push(new Date(m.dueDate));
    }
    for (const t of tasks) {
      if (t.startDate) dates.push(new Date(t.startDate));
      if (t.dueDate) dates.push(new Date(t.dueDate));
    }

    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const start = addDays(min, -7);
    const end = addDays(max, 14);
    const total = daysBetween(start, end);

    const markers: { label: string; left: number }[] = [];
    const cursor = new Date(start);
    cursor.setDate(1);
    while (cursor <= end) {
      const monthStart = new Date(cursor);
      const pct = daysBetween(start, monthStart) / total * 100;
      markers.push({
        label: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        left: Math.max(0, pct),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return { rangeStart: start, totalDays: total, monthMarkers: markers };
  }, [projects, milestones, tasks, serverNow]);

  // ── Bar position calculation ────────────────────────────

  const barStyle = useCallback((startStr: string | null, endStr: string | null) => {
    if (!startStr) return { left: '0%', width: '0%', display: 'none' as const };
    const start = new Date(startStr);
    const end = endStr ? new Date(endStr) : new Date(startStr);
    const left = Math.max(0, daysBetween(rangeStart, start) / totalDays * 100);
    const width = Math.max(3, daysBetween(start, end) / totalDays * 100);
    const clampedWidth = Math.min(width, 100 - left);
    return { left: `${left}%`, width: `${clampedWidth}%` };
  }, [rangeStart, totalDays]);

  // ── Build hierarchy rows ────────────────────────────────

  const rows = useMemo(() => {
    const result: TimelineItem[] = [];
    for (const p of projects) {
      result.push({
        id: p.id, type: 'project', parentId: null,
        name: p.name, status: p.status,
        startDate: p.startDate ? new Date(p.startDate).toISOString() : null,
        endDate: p.endDate ? new Date(p.endDate).toISOString() : null,
        progress: p.progress, priority: null,
      });
      if (expandedProjects.has(p.id)) {
        for (const m of milestones.filter(m => m.projectId === p.id)) {
          result.push({
            id: m.id, type: 'milestone', parentId: p.id,
            name: `◆ ${m.name}`, status: m.status,
            startDate: m.dueDate ? new Date(m.dueDate).toISOString() : null,
            endDate: m.dueDate ? new Date(m.dueDate).toISOString() : null,
            progress: null, priority: null,
          });
        }
        for (const t of tasks.filter(t => t.projectId === p.id)) {
          result.push({
            id: t.id, type: 'task', parentId: p.id,
            name: t.title, status: t.status,
            startDate: t.startDate ? new Date(t.startDate).toISOString() : null,
            endDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
            progress: null, priority: t.priority,
          });
        }
      }
    }
    return result;
  }, [projects, milestones, tasks, expandedProjects]);

  // ── Drag handlers ───────────────────────────────────────

  const handleBarMouseDown = useCallback((e: React.MouseEvent, item: TimelineItem) => {
    e.preventDefault();
    const rect = timelineBodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const barEl = e.currentTarget as HTMLElement;
    const barRect = barEl.getBoundingClientRect();
    // Store the offset between the click point and the bar's left edge
    dragStartOffsetRef.current = e.clientX - barRect.left;
    setDragging({
      id: item.id,
      type: item.type,
      startX: e.clientX,
      origStart: item.startDate,
      origEnd: item.endDate,
    });
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = timelineBodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - dragging.startX;
      setDragOffset(dx);
    };

    const handleMouseUp = async (e: MouseEvent) => {
      if (!timelineBodyRef.current || !dragging) return;

      const rect = timelineBodyRef.current.getBoundingClientRect();
      // Calculate new position based on drag delta from original bar position
      const origBarLeft = (() => {
        // Find the original bar's left position in pixels
        const origStart = dragging.origStart ? new Date(dragging.origStart) : null;
        if (!origStart) return 0;
        return daysBetween(rangeStart, origStart) / totalDays * rect.width;
      })();

      const newBarLeftPx = origBarLeft + (e.clientX - dragging.startX);
      const pct = Math.max(0, Math.min(1, newBarLeftPx / rect.width));
      const daysOffset = pct * totalDays;
      const newStartDate = addDays(rangeStart, Math.round(daysOffset));

      const origEnd = dragging.origEnd ? new Date(dragging.origEnd) : null;
      const origStart = dragging.origStart ? new Date(dragging.origStart) : null;
      const duration = origStart && origEnd ? daysBetween(origStart, origEnd) : 1;
      const newEndDate = addDays(newStartDate, duration);

      try {
        const res = await fetch('/api/gantt/data', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: dragging.type,
            id: dragging.id,
            startDate: newStartDate.toISOString().split('T')[0],
            endDate: newEndDate.toISOString().split('T')[0],
          }),
        });
        if (res.ok) fetchData();
      } catch {
        // Silently fail — data stays unchanged
      }

      setDragging(null);
      setDragOffset(0);
      dragStartOffsetRef.current = 0;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, totalDays, rangeStart, fetchData]);

  // ── Toggle project expand ───────────────────────────────

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="flex h-full flex-col space-y-4"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-surface-900 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <CalendarDays className="h-4 w-4 text-white" />
            </div>
            Gantt Chart
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">Drag bars to reschedule projects, milestones, and tasks</p>
        </div>
        {rows.length > 0 && (
          <p className="text-surface-400 text-xs">
            {projects.length} project{projects.length !== 1 ? 's' : ''} · {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {milestones.length} milestone{milestones.length !== 1 ? 's' : ''}
          </p>
        )}
      </motion.div>

      {/* Main Gantt area */}
      <motion.div variants={itemVariants} className="neon-card relative min-h-0 flex-1 overflow-hidden rounded-2xl">
        

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-24">
            <AlertCircle className="text-error mb-2 h-8 w-8" />
            <p className="text-error text-sm">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-24">
            <div className="bg-surface-100/50 border-surface-300/20 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
              <CalendarDays className="text-surface-400 h-7 w-7" />
            </div>
            <h3 className="text-surface-900 text-base font-semibold">No timeline data yet</h3>
            <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
              Create projects with start and end dates to see them on the Gantt chart.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            {/* Timeline header: month markers */}
            <div className="border-surface-300/10 relative flex h-8 shrink-0 border-b">
              <div className="w-64 shrink-0 border-r border-surface-300/10 " />
              <div className="relative flex-1 overflow-hidden">
                {monthMarkers.map((m, i) => (
                  <div
                    key={i}
                    className="border-surface-300/10 absolute top-0 h-full border-l"
                    style={{ left: `${m.left}%` }}
                  >
                    <span className="text-surface-500 absolute left-1 top-1 text-[9px] font-medium whitespace-nowrap">{m.label}</span>
                  </div>
                ))}
                {/* Today marker */}
                {(() => {
                  const todayLeft = daysBetween(rangeStart, new Date(serverNow)) / totalDays * 100;
                  if (todayLeft < 0 || todayLeft > 100) return null;
                  return <div className="bg-error/60 absolute top-0 h-full w-px" style={{ left: `${todayLeft}%` }} title="Today" />;
                })()}
              </div>
            </div>

            {/* Scrollable body with attached ref */}
            <div ref={timelineBodyRef} className="flex-1 overflow-auto">
              {rows.map((item) => {
                const isProject = item.type === 'project';
                const isMilestone = item.type === 'milestone';
                const isExpanded = isProject && expandedProjects.has(item.id);
                const color = getStatusColor(item.status);
                const pos = barStyle(item.startDate, item.endDate);
                const isDragging = dragging?.id === item.id;

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className={cn(
                      'border-surface-300/5 group flex h-9 items-stretch border-b transition-colors',
                      isProject && 'bg-surface-50/80 ',
                      isMilestone && 'bg-surface-50/40 ',
                    )}
                  >
                    {/* Left label */}
                    <div className="flex w-64 shrink-0 items-center gap-1.5 border-r border-surface-300/10 px-3 ">
                      {isProject && (
                        <button
                          onClick={() => toggleProject(item.id)}
                          aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
                          className="text-surface-400 hover:text-surface-600 rounded p-0.5 transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}
                      {isMilestone && <Diamond className="text-surface-400 h-2.5 w-2.5 shrink-0" />}
                      <span className={cn(
                        'truncate text-xs',
                        isProject && 'text-surface-900 font-semibold',
                        isMilestone && 'text-surface-500 font-medium',
                        !isProject && !isMilestone && 'text-surface-600 ',
                      )}>
                        {item.name}
                      </span>
                      {!isProject && (
                        <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', STATUS_BG[item.status] ?? 'bg-surface-300')} />
                      )}
                    </div>

                    {/* Timeline bar area */}
                    <div className="relative flex-1">
                      {monthMarkers.map((m, i) => (
                        <div key={i} className="border-surface-300/5 absolute inset-y-0 border-l" style={{ left: `${m.left}%` }} />
                      ))}

                      {/* Dragged bar ghost */}
                      {isDragging && (
                        <div
                          className="pointer-events-none absolute inset-y-1.5 z-20 rounded-md opacity-30"
                          style={{
                            left: pos.left,
                            width: isMilestone ? '12px' : pos.width,
                            backgroundColor: `${color}30`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: isMilestone ? '2px' : '6px',
                          }}
                        />
                      )}

                      {/* Bar */}
                      {pos.display !== 'none' && (
                        <div
                          className={cn(
                            'absolute inset-y-1.5 cursor-grab rounded-md transition-shadow select-none active:cursor-grabbing',
                            isMilestone ? 'h-3 -translate-y-1/2 top-1/2' : '',
                            isDragging ? 'shadow-lg ring-2 ring-brand-500/40 z-30' : 'hover:shadow-md hover:z-10',
                          )}
                          style={{
                            left: pos.left,
                            width: isMilestone ? '12px' : pos.width,
                            backgroundColor: isMilestone ? 'transparent' : `${color}30`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: isMilestone ? '2px' : '6px',
                            transform: isDragging ? `translateX(${dragOffset}px)` : undefined,
                            transition: isDragging ? 'none' : undefined,
                          }}
                          onMouseDown={(e) => handleBarMouseDown(e, item)}
                          title={`${item.name}: ${formatDate(item.startDate)} — ${formatDate(item.endDate)}`}
                        >
                          <span className="text-surface-700 truncate px-2 text-[10px] font-medium leading-6">
                            {formatDate(item.startDate)}
                            {!isMilestone && item.startDate && item.endDate && item.startDate !== item.endDate && (
                              <> — {formatDate(item.endDate)}</>
                            )}
                          </span>
                          <div className="absolute inset-y-0 right-0 flex items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <GripHorizontal className="text-surface-400 h-2.5 w-2.5" />
                          </div>
                          {isProject && item.progress != null && (
                            <div
                              className="absolute inset-y-0 left-0 rounded-l-md opacity-20"
                              style={{
                                width: `${item.progress}%`,
                                backgroundColor: color,
                                borderRadius: item.progress >= 100 ? '6px' : '6px 0 0 6px',
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </motion.div>

      {/* Legend & hint */}
      {rows.length > 0 && (
        <motion.div variants={itemVariants} className="flex items-center justify-between px-1">
          <div className="flex items-center gap-4 text-[10px] text-surface-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-indigo-500/30" style={{ borderLeft: '2px solid #6366f1' }} />
              Project
            </span>
            <span className="flex items-center gap-1">
              <Diamond className="h-2.5 w-2.5 text-surface-400" />
              Milestone
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded bg-blue-500/30" style={{ borderLeft: '2px solid #3b82f6' }} />
              Task
            </span>
          </div>
          <p className="text-surface-400 text-[10px]">
            <GripHorizontal className="mr-0.5 inline h-3 w-3" />
            Drag bars to reschedule · Today shown as <span className="text-error">red line</span>
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
