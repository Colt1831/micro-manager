'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  ChevronRight as ArrowRight,
  Calendar as CalendarIcon,
  ChevronDown,
  Plus,
  Diamond,
  Flag,
  Loader2,
  GripVertical,
  Plane,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { toast } from '@/hooks/use-toast';

// ─── Types ──────────────────────────────────────────────────

export type Task = {
  id: string;
  title: string;
  dueDate: string | null;
  status: string;
  priority: string;
};

export type Milestone = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  completedDate: string | null;
};

export type Leave = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  user: { id: string; name: string | null } | null;
  leaveType: { name: string | null; color: string | null } | null;
};

/**
 * Expand each approved leave into a Map keyed by each covered day's
 * `Date.toDateString()`, so a multi-day leave shows on every day it spans.
 * Pure + exported for a focused unit test.
 */
export function leavesByDateFrom(leaves: Leave[]): Map<string, Leave[]> {
  const map = new Map<string, Leave[]>();
  for (const lv of leaves) {
    // Dates are `YYYY-MM-DD`; parse as local midnight to avoid TZ drift.
    const start = new Date(`${lv.startDate}T00:00:00`);
    const end = new Date(`${lv.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) continue;
    for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const key = cur.toDateString();
      const arr = map.get(key);
      if (arr) arr.push(lv);
      else map.set(key, [lv]);
    }
  }
  return map;
}

type ViewMode = 'month' | 'week' | 'day';

// ─── Constants ──────────────────────────────────────────────

const MILESTONE_COLORS = [
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  draft:       { label: 'Draft',       color: '#6b7280', dot: 'bg-gray-500' },
  open:        { label: 'Open',        color: '#60a5fa', dot: 'bg-blue-400' },
  in_progress: { label: 'In Progress', color: '#fbbf24', dot: 'bg-amber-400' },
  blocked:     { label: 'Blocked',     color: '#f87171', dot: 'bg-red-400' },
  under_review:{ label: 'Under Review',color: '#22d3ee', dot: 'bg-cyan-400' },
  on_hold:     { label: 'On Hold',     color: '#a78bfa', dot: 'bg-violet-400' },
  completed:   { label: 'Completed',   color: '#34d399', dot: 'bg-emerald-400' },
  closed:      { label: 'Closed',      color: '#818cf8', dot: 'bg-indigo-400' },
  cancelled:   { label: 'Cancelled',   color: '#9ca3af', dot: 'bg-gray-400' },
  archived:    { label: 'Archived',    color: '#6b7280', dot: 'bg-gray-500' },
};

const milestoneStatusConfig: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Pending',    color: '#9ca3af' },
  in_progress:{ label: 'In Progress',color: '#f59e0b' },
  completed:  { label: 'Completed',  color: '#34d399' },
  cancelled:  { label: 'Cancelled',  color: '#6b7280' },
};

const priorityConfig: Record<string, { label: string; ring: string }> = {
  none:     { label: 'None',    ring: 'ring-gray-400' },
  low:      { label: 'Low',     ring: 'ring-emerald-500' },
  medium:   { label: 'Medium',  ring: 'ring-amber-500' },
  high:     { label: 'High',    ring: 'ring-orange-500' },
  urgent:   { label: 'Urgent',  ring: 'ring-red-500' },
  critical: { label: 'Critical',ring: 'ring-red-600' },
};

// ─── Helpers ────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekDays(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getMonthStartEnd(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function getMilestoneColor(_milestone: Milestone, index: number): string {
  return MILESTONE_COLORS[index % MILESTONE_COLORS.length]!;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ─── Animation Variants ─────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 120 : -120,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 120 : -120,
    opacity: 0,
  }),
} as const;

const popoverVariants = {
  hidden: { opacity: 0, scale: 0.95, y: -4 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -4,
    transition: { duration: 0.12 },
  },
} as const;

// ─── Task Badge & Popover ───────────────────────────────────

function TaskBadge({ task }: { task: Task }) {
  const config = statusConfig[task.status] ?? statusConfig.draft!;
  const priority = priorityConfig[task.priority] ?? priorityConfig.none!;
  return (
    <span
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight transition-all hover:opacity-80"
      style={{ backgroundColor: `${config.color}18` }}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', priority.ring)}
        style={{ backgroundColor: config.color }}
      />
      <span className="text-surface-700 truncate max-w-[120px]">
        {task.title}
      </span>
    </span>
  );
}

function MilestoneBadge({ milestone, index }: { milestone: Milestone; index: number }) {
  const color = getMilestoneColor(milestone, index);
  return (
    <span
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight transition-all hover:opacity-80"
      style={{ backgroundColor: `${color}15` }}
    >
      <Diamond className="h-2.5 w-2.5 shrink-0" style={{ color }} />
      <span className="text-surface-700 truncate max-w-[120px]">
        {milestone.name}
      </span>
    </span>
  );
}

const LEAVE_DEFAULT_COLOR = '#0ea5e9';

function LeaveBadge({ leave }: { leave: Leave }) {
  const color = leave.leaveType?.color || LEAVE_DEFAULT_COLOR;
  const who = leave.user?.name ?? 'Someone';
  const type = leave.leaveType?.name ?? 'Leave';
  return (
    <span
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight"
      style={{ backgroundColor: `${color}15` }}
      title={`${who} — ${type}${leave.isHalfDay ? ' (half day)' : ''}`}
    >
      <Plane className="h-2.5 w-2.5 shrink-0" style={{ color }} />
      <span className="text-surface-700 truncate max-w-[120px]">
        {who}{leave.isHalfDay ? ' ½' : ''}
      </span>
    </span>
  );
}

// ─── Draggable Task Item ────────────────────────────────────

function DraggableTaskItem({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn('cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="w-full text-left"
            onClick={(e) => {
              if (isDragging) e.preventDefault();
            }}
          >
            <TaskBadge task={task} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="overflow-visible border-0 bg-transparent p-0 shadow-none"
        >
          <TaskPopoverContent task={task} onClose={() => {}} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Droppable Day Cell ─────────────────────────────────────

function DroppableDayCell({
  date,
  isToday,
  children,
  compact,
}: {
  date: Date;
  isToday: boolean;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const dateKey = formatDateKey(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dateKey}`,
    data: { type: 'day', date: date.toISOString() },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(          'border-surface-300/20 group border-b border-r p-1.5 transition-all duration-150',
          compact ? 'min-h-[52px]' : 'min-h-[110px]',
        isToday
          ? 'bg-brand-500/5 '
          : 'hover:bg-surface-100/40 ',
        isOver && 'ring-2 ring-inset ring-brand-500/40 bg-brand-500/10',
      )}
    >
      {children}
    </div>
  );
}

// ─── Drag Overlay Task ──────────────────────────────────────

function DragOverlayTask({ task }: { task: Task | null }) {
  if (!task) return null;
  const config = statusConfig[task.status] ?? statusConfig.draft!;
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1.05, opacity: 1 }}
      className="flex items-center gap-2 rounded-lg bg-surface-300 px-3 py-2 shadow-xl ring-1 ring-white/10"
      style={{ borderLeft: `3px solid ${config.color}` }}
    >
      <GripVertical className="text-surface-300 h-3.5 w-3.5" />
      <span className="text-surface-700 text-xs font-medium max-w-[200px] truncate">
        {task.title}
      </span>
      <span className="text-surface-400 ml-auto text-[10px] font-medium uppercase tracking-wider">
        {config.label}
      </span>
    </motion.div>
  );
}

function TaskPopoverContent({ task, onClose }: { task: Task; onClose: () => void }) {
  const status = statusConfig[task.status] ?? statusConfig.draft!;
  const priority = priorityConfig[task.priority] ?? priorityConfig.none!;

  return (
    <motion.div
      variants={popoverVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="w-72"
    >
      <div
        className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl"
        style={{ backgroundColor: status.color }}
      />
      <div className="pt-3">
        <h4 className="text-surface-900 line-clamp-2 text-sm font-semibold leading-snug">
          {task.title}
        </h4>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            variant={
              task.status === 'completed' || task.status === 'closed'
                ? 'success'
                : task.status === 'blocked'
                  ? 'danger'
                  : task.status === 'in_progress'
                    ? 'warning'
                    : 'default'
            }
            className="px-1.5 py-0 text-[10px]"
          >
            {status.label}
          </Badge>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              task.priority === 'critical' || task.priority === 'urgent'
                ? 'bg-red-500/10 text-red-500'
                : task.priority === 'high'
                  ? 'bg-orange-500/10 text-orange-500'
                  : task.priority === 'medium'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-surface-200/50 text-surface-500 ',
            )}
          >
            {priority.label}
          </span>
        </div>
        {task.dueDate && (
          <div className="text-surface-500 mt-2 flex items-center gap-1.5 text-[11px]">
            <CalendarIcon className="h-3 w-3" />
            {new Date(task.dueDate).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Link href={`/tasks/${task.id}`}>
            <Button size="sm" className="h-7 rounded-lg px-2.5 text-xs">
              View Task
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg px-2 text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function MilestonePopoverContent({ milestone, index, onClose }: { milestone: Milestone; index: number; onClose: () => void }) {
  const color = getMilestoneColor(milestone, index);
  const status = milestoneStatusConfig[milestone.status] ?? milestoneStatusConfig.pending!;

  return (
    <motion.div
      variants={popoverVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="w-72"
    >
      <div
        className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl"
        style={{ backgroundColor: color }}
      />
      <div className="pt-3">
        <div className="flex items-center gap-1.5 text-[11px] text-surface-500 mb-1">
          <Flag className="h-3 w-3" />
          <span>Milestone</span>
          <span className="text-surface-300 ">·</span>
          <span className="truncate">{milestone.projectName}</span>
        </div>
        <h4 className="text-surface-900 line-clamp-2 text-sm font-semibold leading-snug">
          {milestone.name}
        </h4>
        {milestone.description && (
          <p className="text-surface-500 mt-1.5 line-clamp-3 text-xs leading-relaxed">
            {milestone.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            variant={
              milestone.status === 'completed'
                ? 'success'
                : milestone.status === 'in_progress'
                  ? 'warning'
                  : 'default'
            }
            className="px-1.5 py-0 text-[10px]"
          >
            {status.label}
          </Badge>
          {milestone.dueDate && (
            <span className="text-surface-500 flex items-center gap-1 text-[11px]">
              <CalendarIcon className="h-3 w-3" />
              {new Date(milestone.dueDate).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Link href={`/projects/${milestone.projectId}`}>
            <Button size="sm" className="h-7 rounded-lg px-2.5 text-xs">
              View Project
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg px-2 text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Month Picker ───────────────────────────────────────────

function MonthPicker({
  year,
  month,
  onSelect,
  onClose,
}: {
  year: number;
  month: number;
  onSelect: (year: number, month: number) => void;
  onClose: () => void;
}) {
  const [selectedYear, setSelectedYear] = useState(year);

  return (
    <div className="w-56 p-2">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setSelectedYear((y) => y - 1)}
          className="text-surface-500 hover:text-surface-700 rounded-lg p-1 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-surface-700 text-sm font-semibold">
          {selectedYear}
        </span>
        <button
          onClick={() => setSelectedYear((y) => y + 1)}
          className="text-surface-500 hover:text-surface-700 rounded-lg p-1 transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS_SHORT.map((m, i) => {
          const isSelected = selectedYear === year && i === month;
          return (
            <button
              key={m}
              onClick={() => {
                onSelect(selectedYear, i);
                onClose();
              }}
              className={cn(
                'rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                isSelected
                  ? 'bg-brand-500 text-white'
                  : 'text-surface-600 hover:bg-surface-200/70 hover:text-surface-900 ',
              )}
            >
              {m}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => {
          const now = new Date();
          onSelect(now.getFullYear(), now.getMonth());
          onClose();
        }}
        className="text-brand-500 hover:bg-brand-500/5 mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-medium transition-colors"
      >
        Go to today
      </button>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 120, damping: 14 }}
      className="flex flex-col items-center justify-center py-16"
    >
      <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
        <CalendarIcon className="text-surface-400 h-7 w-7" />
      </div>
      <h3 className="text-surface-900 text-base font-semibold">
        No tasks or milestones with dates
      </h3>
      <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
        Tasks and milestones appear on the calendar when they have due dates assigned. Create a task or milestone to see it here.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Link href="/tasks/new">
          <Button className="h-8 rounded-xl px-3 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Task
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Views ──────────────────────────────────────────────────

function MonthView({
  year,
  month,
  today,
  tasksByDate,
  milestonesByDate,
  leavesByDate,
}: {
  year: number;
  month: number;
  today: Date;
  tasksByDate: Map<string, Task[]>;
  milestonesByDate: Map<string, Milestone[]>;
  leavesByDate: Map<string, Leave[]>;
}) {
  const { firstDay, daysInMonth } = getMonthStartEnd(year, month);

  return (
    <div className="border-surface-300/20 grid grid-cols-7 border-l border-t">
      {DAYS.map((d) => (
        <div
          key={d}
          className="border-surface-300/20 bg-surface-50/50 border-b border-r px-1.5 py-2"
        >
          <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
            {d}
          </span>
        </div>
      ))}
      {Array.from({ length: firstDay }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="border-surface-300/20 bg-surface-50/30 min-h-[100px] border-b border-r p-1"
        />
      ))}
      {Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1;
        const date = new Date(year, month, day);
        const isToday = isSameDay(date, today);
        const dateKey = date.toDateString();
        const dayTasks = tasksByDate.get(dateKey) ?? [];
        const dayMilestones = milestonesByDate.get(dateKey) ?? [];
        const dayLeaves = leavesByDate.get(dateKey) ?? [];
        const totalItems = dayTasks.length + dayMilestones.length + dayLeaves.length;

        return (
          <DroppableDayCell key={day} date={date} isToday={isToday}>
            <div className="mb-1 flex items-center justify-between">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  isToday
                    ? 'bg-brand-500 text-white text-[11px]'
                    : 'text-surface-500',
                )}
              >
                {day}
              </span>
              {totalItems > 0 && (
                <span className="text-surface-400 text-[9px] font-medium">
                  {totalItems}
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {/* Unified 3-slot budget across leave → milestones → tasks so a
                  busy day never overflows; one "+N more" covers all hidden. */}
              {(() => {
                const CAP = 3;
                const visibleLeaves = dayLeaves.slice(0, CAP);
                const afterLeaves = CAP - visibleLeaves.length;
                const visibleMilestones = dayMilestones.slice(0, afterLeaves);
                const afterMilestones = afterLeaves - visibleMilestones.length;
                const visibleTasks = dayTasks.slice(0, afterMilestones);
                const hidden = totalItems - visibleLeaves.length - visibleMilestones.length - visibleTasks.length;
                return (
                  <>
                    {visibleLeaves.map((lv) => (
                      <LeaveBadge key={`lv-${lv.id}`} leave={lv} />
                    ))}
                    {visibleMilestones.map((m, idx) => (
                      <Popover key={m.id}>
                        <PopoverTrigger asChild>
                          <button className="w-full text-left">
                            <MilestoneBadge milestone={m} index={idx} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="right"
                          align="start"
                          sideOffset={8}
                          className="overflow-visible border-0 bg-transparent p-0 shadow-none"
                        >
                          <MilestonePopoverContent milestone={m} index={idx} onClose={() => {}} />
                        </PopoverContent>
                      </Popover>
                    ))}
                    {visibleTasks.map((t) => (
                      <DraggableTaskItem key={t.id} task={t} />
                    ))}
                    {hidden > 0 && (
                      <p className="text-surface-400 px-1 text-[9px] font-medium">
                        +{hidden} more
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </DroppableDayCell>
        );
      })}
    </div>
  );
}

function WeekView({
  weekDays,
  today,
  tasksByDate,
  milestonesByDate,
  leavesByDate,
}: {
  weekDays: Date[];
  today: Date;
  tasksByDate: Map<string, Task[]>;
  milestonesByDate: Map<string, Milestone[]>;
  leavesByDate: Map<string, Leave[]>;
}) {
  const maxItemsPerDay = useMemo(() => {
    let max = 0;
    weekDays.forEach((d) => {
      const key = d.toDateString();
      const tasks = tasksByDate.get(key) ?? [];
      const milestones = milestonesByDate.get(key) ?? [];
      const leaves = leavesByDate.get(key) ?? [];
      max = Math.max(max, tasks.length + milestones.length + leaves.length);
    });
    return max;
  }, [weekDays, tasksByDate, milestonesByDate, leavesByDate]);

  return (
    <div className="border-surface-300/20 grid grid-cols-7 border-l border-t">
      {weekDays.map((d, i) => {
        const isToday = isSameDay(d, today);
        return (
          <div
            key={i}
            className={cn(
              'border-surface-300/20 border-b border-r px-2 py-2.5',
              isToday ? 'bg-brand-500/5' : 'bg-surface-50/50 ',
            )}
          >
            <div className="flex flex-col items-center">
              <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                {DAYS[i]}
              </span>
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                  isToday
                    ? 'bg-brand-500 text-white'
                    : 'text-surface-700 ',
                )}
              >
                {d.getDate()}
              </span>
            </div>
          </div>
        );
      })}
      {Array.from({ length: Math.max(1, Math.min(maxItemsPerDay, 6)) }).map(
        (_, rowIdx) => (
          <Fragment key={rowIdx}>
            {weekDays.map((d, dayIdx) => {
              const key = d.toDateString();
              const tasks = tasksByDate.get(key) ?? [];
              const milestones = milestonesByDate.get(key) ?? [];
              const leaves = leavesByDate.get(key) ?? [];
              const allItems = [...leaves, ...milestones, ...tasks];
              const item = allItems[rowIdx];
              return (
                <DroppableDayCell
                  key={`${rowIdx}-${dayIdx}`}
                  date={d}
                  isToday={isSameDay(d, today)}
                  compact
                >
                  {item && 'leaveType' in item ? (
                    <LeaveBadge key={`lv-${rowIdx}-${dayIdx}-${item.id}`} leave={item as Leave} />
                  ) : item && 'projectName' in item ? (
                    <Popover key={`ms-${rowIdx}-${dayIdx}-${item.id}`}>
                      <PopoverTrigger asChild>
                        <button className="w-full text-left">
                          <MilestoneBadge milestone={item as Milestone} index={rowIdx} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="right"
                        align="start"
                        sideOffset={8}
                        className="overflow-visible border-0 bg-transparent p-0 shadow-none"
                      >
                        <MilestonePopoverContent
                          milestone={item as Milestone}
                          index={rowIdx}
                          onClose={() => {}}
                        />
                      </PopoverContent>
                    </Popover>
                  ) : item ? (
                    <DraggableTaskItem task={item as Task} />
                  ) : null}
                </DroppableDayCell>
              );
            })}
          </Fragment>
        ),
      )}
      {maxItemsPerDay === 0 && (
        <div className="col-span-7 flex items-center justify-center py-8">
          <p className="text-surface-400 text-xs">No items due this week</p>
        </div>
      )}
    </div>
  );
}

// ─── Day View ───────────────────────────────────────────────

function DayView({
  date,
  today,
  tasksByDate,
  milestonesByDate,
  leavesByDate,
}: {
  date: Date;
  today: Date;
  tasksByDate: Map<string, Task[]>;
  milestonesByDate: Map<string, Milestone[]>;
  leavesByDate: Map<string, Leave[]>;
}) {
  const isToday = isSameDay(date, today);
  const key = date.toDateString();
  const dayTasks = tasksByDate.get(key) ?? [];
  const dayMilestones = milestonesByDate.get(key) ?? [];
  const dayLeaves = leavesByDate.get(key) ?? [];
  const totalItems = dayTasks.length + dayMilestones.length + dayLeaves.length;

  return (
    <div className="border-surface-300/20 grid grid-cols-1 border-l border-t">
      {/* Day header */}
      <div
        className={cn(
          'border-surface-300/20 border-b border-r px-3 py-2.5',
          isToday ? 'bg-brand-500/5' : 'bg-surface-50/50 ',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
            {DAYS[date.getDay()]}
          </span>
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
              isToday ? 'bg-brand-500 text-white' : 'text-surface-700 ',
            )}
          >
            {date.getDate()}
          </span>
          <span className="text-surface-500 text-xs">
            {MONTHS[date.getMonth()]} {date.getFullYear()}
          </span>
        </div>
      </div>

      {/* Day items — all items listed (no cap; a single day has room) */}
      <DroppableDayCell date={date} isToday={isToday}>
        {totalItems === 0 ? (
          <p className="text-surface-400 py-6 text-center text-xs">
            No items due this day
          </p>
        ) : (
          <div className="space-y-0.5">
            {dayLeaves.map((lv) => (
              <LeaveBadge key={`lv-${lv.id}`} leave={lv} />
            ))}
            {dayMilestones.map((m, idx) => (
              <Popover key={m.id}>
                <PopoverTrigger asChild>
                  <button className="w-full text-left">
                    <MilestoneBadge milestone={m} index={idx} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="overflow-visible border-0 bg-transparent p-0 shadow-none"
                >
                  <MilestonePopoverContent milestone={m} index={idx} onClose={() => {}} />
                </PopoverContent>
              </Popover>
            ))}
            {dayTasks.map((t) => (
              <DraggableTaskItem key={t.id} task={t} />
            ))}
          </div>
        )}
      </DroppableDayCell>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export interface CalendarClientProps {
  /** Server-seeded tasks; null means the server load failed and the client fetches on mount. */
  initialTasks: Task[] | null;
  initialMilestones: Milestone[];
  /** Server render time (ms) — keeps the current-month view + today highlight identical between SSR and hydration. */
  serverNow: number;
}

export function CalendarClient({ initialTasks, initialMilestones, serverNow }: CalendarClientProps) {
  const [hadInitialData] = useState(() => initialTasks !== null);
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? []);
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(initialTasks === null);
  // Seed the current month from the server clock so SSR and first hydration render
  // the same grid; user navigation (prev/next) drives it from there.
  const [currentDate, setCurrentDate] = useState(() => new Date(serverNow));
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [direction, setDirection] = useState(0);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  useEffect(() => {
    if (hadInitialData) return; // server already seeded tasks + milestones
    Promise.all([
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/milestones').then((r) => r.json()),
    ])
      .then(([tasksData, milestonesData]) => {
        setTasks(tasksData.tasks ?? []);
        setMilestones(milestonesData.milestones ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hadInitialData]);

  // Approved leave is never server-seeded — fetch the visible window on mount
  // and whenever the viewed month changes. A ±1 month buffer covers the grid's
  // leading/trailing days and week view near month edges. Failure leaves the
  // overlay empty (non-blocking).
  useEffect(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const from = new Date(y, m - 1, 1).toISOString().slice(0, 10);
    const to = new Date(y, m + 2, 0).toISOString().slice(0, 10); // last day of m+1
    const controller = new AbortController();
    fetch(`/api/leave-requests?status=approved&from=${from}&to=${to}&limit=200`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setLeaves(data.requests ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [currentDate]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = useMemo(() => {
    const d = new Date(serverNow);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [serverNow]);

  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);

  const navigate = useCallback(
    (dir: number) => {
      setDirection(dir);
      if (viewMode === 'month') {
        setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
      } else {
        setCurrentDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() + dir * (viewMode === 'week' ? 7 : 1));
          return d;
        });
      }
    },
    [viewMode],
  );

  const goToday = useCallback(() => {
    setDirection(0);
    setCurrentDate(new Date());
  }, []);

  const goToMonth = useCallback((y: number, m: number) => {
    setDirection(0);
    setCurrentDate(new Date(y, m, 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'ArrowRight') navigate(1);
      else if (e.key === 'T' || e.key === 't') goToday();
      else if (e.key === 'w' || e.key === 'W') setViewMode('week');
      else if (e.key === 'm' || e.key === 'M') setViewMode('month');
      else if (e.key === 'd' || e.key === 'D') setViewMode('day');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, goToday]);

  // Build date maps
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      if (t.dueDate) {
        const key = new Date(t.dueDate).toDateString();
        const existing = map.get(key) ?? [];
        existing.push(t);
        map.set(key, existing);
      }
    });
    return map;
  }, [tasks]);

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    milestones.forEach((m) => {
      if (m.dueDate) {
        const key = new Date(m.dueDate).toDateString();
        const existing = map.get(key) ?? [];
        existing.push(m);
        map.set(key, existing);
      }
    });
    return map;
  }, [milestones]);

  const leavesByDate = useMemo(() => leavesByDateFrom(leaves), [leaves]);

  const hasItemsOnCalendar = useMemo(
    () => tasks.some((t) => t.dueDate) || milestones.some((m) => m.dueDate) || leaves.length > 0,
    [tasks, milestones, leaves],
  );

  const milestoneCount = useMemo(
    () => milestones.filter((m) => m.dueDate).length,
    [milestones],
  );

  // ── Drag-and-Drop Handlers ────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const task = active.data.current?.task as Task | undefined;
    if (task) setActiveDragTask(task);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragTask(null);

      if (!over) return;

      const task = active.data.current?.task as Task | undefined;
      if (!task || task.status === 'completed' || task.status === 'closed') {
        if (task && (task.status === 'completed' || task.status === 'closed')) {
          toast({
            title: 'Cannot reschedule',
            description: `This task is ${task.status} and cannot be edited.`,
            variant: 'warning',
          });
        }
        return;
      }

      const targetDate = over.data.current?.date as string | undefined;
      if (!targetDate) return;

      const newDueDate = new Date(targetDate);
      const oldDueDate = task.dueDate ? new Date(task.dueDate) : null;

      // Skip if dropped on the same day
      if (oldDueDate && isSameDay(newDueDate, oldDueDate)) return;

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, dueDate: newDueDate.toISOString() } : t,
        ),
      );
      setRescheduling(true);

      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dueDate: newDueDate.toISOString() }),
        });

        if (!res.ok) {
          // Revert on failure
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, dueDate: oldDueDate?.toISOString() ?? null } : t,
            ),
          );
          const data = await res.json();
          toast({
            title: 'Failed to reschedule',
            description: data.error?.message ?? 'An error occurred',
            variant: 'error',
          });
          return;
        }

        toast({
          title: 'Task rescheduled',
          description: `Moved to ${newDueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          variant: 'success',
        });
      } catch {
        // Revert on network error
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, dueDate: oldDueDate?.toISOString() ?? null } : t,
          ),
        );
        toast({
          title: 'Network error',
          description: 'Could not reschedule the task. Please try again.',
          variant: 'error',
        });
      } finally {
        setRescheduling(false);
      }
    },
    [],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragTask(null);
  }, []);

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-32 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-48 rounded-lg" />
        </div>
        <div className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-5">
          <div className="shimmer h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={hadInitialData ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-surface-900 text-2xl font-bold tracking-tight">
            Calendar
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            Task deadlines, milestones, and approved leave
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Rescheduling indicator */}
          {rescheduling && (
            <span className="flex items-center gap-1.5 text-[11px] text-surface-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {/* View toggle */}
          <div
            className="bg-surface-200/50 flex items-center gap-0.5 rounded-xl p-0.5"
            role="tablist"
            aria-label="Calendar view mode"
          >
            <button
              role="tab"
              aria-selected={viewMode === 'month'}
              onClick={() => setViewMode('month')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                viewMode === 'month'
                  ? 'bg-surface-50 text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 ',
              )}
            >
              Month
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'week'}
              onClick={() => setViewMode('week')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                viewMode === 'week'
                  ? 'bg-surface-50 text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 ',
              )}
            >
              Week
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'day'}
              onClick={() => setViewMode('day')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                viewMode === 'day'
                  ? 'bg-surface-50 text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 ',
              )}
            >
              Day
            </button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          {/* Navigation bar */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate(-1)}
                className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-xl p-2 transition-all"
                aria-label={viewMode === 'month' ? 'Previous month' : viewMode === 'week' ? 'Previous week' : 'Previous day'}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToday}
                className="h-8 rounded-lg px-2.5 text-xs"
              >
                Today
              </Button>
              <button
                onClick={() => navigate(1)}
                className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-xl p-2 transition-all"
                aria-label={viewMode === 'month' ? 'Next month' : viewMode === 'week' ? 'Next week' : 'Next day'}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Month title with picker */}
            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
              <PopoverTrigger asChild>
                <button className="text-surface-900 hover:bg-surface-200/50 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-base font-semibold transition-colors">
                  {viewMode === 'month' ? (
                    <>{MONTHS[month]} {year}</>
                  ) : viewMode === 'week' ? (
                    <>
                      {MONTHS_SHORT[weekDays[0]!.getMonth()]} {weekDays[0]!.getDate()}
                      {' — '}
                      {MONTHS_SHORT[weekDays[6]!.getMonth()]} {weekDays[6]!.getDate()}, {weekDays[6]!.getFullYear()}
                    </>
                  ) : (
                    <>
                      {DAYS[currentDate.getDay()]} {MONTHS_SHORT[currentDate.getMonth()]} {currentDate.getDate()}, {currentDate.getFullYear()}
                    </>
                  )}
                  <ChevronDown className="text-surface-400 h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="center"
                sideOffset={6}
                className="w-auto border-0 bg-transparent p-0 shadow-none"
              >
                <MonthPicker
                  year={year}
                  month={month}
                  onSelect={goToMonth}
                  onClose={() => setMonthPickerOpen(false)}
                />
              </PopoverContent>
            </Popover>

            {/* Keyboard hints */}
            <div className="hidden items-center gap-2 md:flex">
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">←</kbd>
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">→</kbd>
              <span className="text-surface-400 text-[10px]">Navigate</span>
              <span className="text-surface-300 mx-1">·</span>
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">T</kbd>
              <span className="text-surface-400 text-[10px]">Today</span>
              <span className="text-surface-300 mx-1">·</span>
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">M</kbd>
              <span className="text-surface-400 text-[10px]">/</span>
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">W</kbd>
              <span className="text-surface-400 text-[10px]">/</span>
              <kbd className="bg-surface-200/50 text-surface-500 rounded-md px-1.5 py-0.5 text-[10px] font-mono">D</kbd>
              <span className="text-surface-400 text-[10px]">Views</span>
            </div>
          </div>

          {/* Calendar grid */}
          {!hasItemsOnCalendar ? (
            <EmptyState />
          ) : (
            <div className="overflow-hidden">
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={
                      viewMode === 'month'
                        ? `month-${year}-${month}`
                        : viewMode === 'week'
                          ? `week-${weekDays[0]!.toDateString()}`
                          : `day-${currentDate.toDateString()}`
                    }
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: 'spring', stiffness: 250, damping: 28 },
                      opacity: { duration: 0.15 },
                    }}
                  >
                    {viewMode === 'month' ? (
                      <MonthView
                        year={year}
                        month={month}
                        today={today}
                        tasksByDate={tasksByDate}
                        milestonesByDate={milestonesByDate}
                        leavesByDate={leavesByDate}
                      />
                    ) : viewMode === 'week' ? (
                      <WeekView
                        weekDays={weekDays}
                        today={today}
                        tasksByDate={tasksByDate}
                        milestonesByDate={milestonesByDate}
                        leavesByDate={leavesByDate}
                      />
                    ) : (
                      <DayView
                        date={currentDate}
                        today={today}
                        tasksByDate={tasksByDate}
                        milestonesByDate={milestonesByDate}
                        leavesByDate={leavesByDate}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Drag overlay */}
                <DragOverlay dropAnimation={null}>
                  {activeDragTask && <DragOverlayTask task={activeDragTask} />}
                </DragOverlay>
              </DndContext>
            </div>
          )}

          {/* Legend */}
          {hasItemsOnCalendar && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-surface-300/10 pt-3">
              <span className="text-surface-500 text-[10px] font-medium uppercase tracking-wider">
                Status
              </span>
              {Object.entries(statusConfig).map(([key, config]) => (
                <span
                  key={key}
                  className="flex items-center gap-1.5 text-[10px] text-surface-500"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: config.color }}
                  />
                  {config.label}
                </span>
              ))}
              {milestoneCount > 0 && (
                <>
                  <span className="text-surface-300 text-[10px]">·</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-violet-500 font-medium">
                    <Diamond className="h-2.5 w-2.5" />
                    {milestoneCount} milestone{milestoneCount !== 1 ? 's' : ''}
                  </span>
                </>
              )}
              {leaves.length > 0 && (
                <>
                  <span className="text-surface-300 text-[10px]">·</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: LEAVE_DEFAULT_COLOR }}>
                    <Plane className="h-2.5 w-2.5" />
                    Approved leave
                  </span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drag hint tooltip */}
      {hasItemsOnCalendar && (
        <div className="text-surface-400 flex items-center justify-center gap-2 text-[10px]">
          <GripVertical className="h-3 w-3" />
          <span>Drag tasks between days to reschedule</span>
        </div>
      )}
    </motion.div>
  );
}
