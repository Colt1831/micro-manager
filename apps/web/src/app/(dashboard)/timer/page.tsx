'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Clock,
  Play,
  Square,
  Plus,
  Loader2,
  CheckCircle2,
  Calendar,
  TrendingUp,
  BarChart3,
  Trash2,
  Search,
  AlertCircle,
  Timer,
  ListTodo,
  ChevronRight,
  X,
  History,
  GripHorizontal,
  Moon,
  Pen,
  ThumbsUp,
  ThumbsDown,
  FileEdit,
  Ban,
} from 'lucide-react';
import {
  useTimeEntries,
  useRunningTimer,
  useTaskSearch,
  useCurrentShift,
  type TimeEntry,
} from '@/hooks/use-time-tracking';
import { useToast } from '@/hooks/use-toast';

// ─── Helpers ────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateString: string): string {
  const d = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

const statusColors: Record<string, string> = {
  todo: 'bg-blue-500/10 text-blue-400',
  in_progress: 'bg-amber-500/10 text-amber-400',
  in_review: 'bg-purple-500/10 text-purple-400',
  completed: 'bg-green-500/10 text-green-400',
  closed: 'bg-surface-500/10 text-surface-400',
  reopened: 'bg-cyan-500/10 text-cyan-400',
  archived: 'bg-slate-500/10 text-slate-400',
  blocked: 'bg-red-500/10 text-red-400',
};

const statusLabels: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  completed: 'Completed',
  closed: 'Closed',
  reopened: 'Reopened',
  archived: 'Archived',
  blocked: 'Blocked',
};

const IDLE_TIMEOUT_MS = 900_000; // 15 minutes
const IDLE_CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

const ENTRY_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#06b6d4',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#22c55e',
];

function getEntryColor(index: number): string {
  return ENTRY_COLORS[index % ENTRY_COLORS.length]!;
}

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

const entryVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) =>
    ({
      opacity: 1,
      x: 0,
      transition: { delay: i * 0.03, type: 'spring', stiffness: 120, damping: 16 },
    } as const),
} as const;

// ═══════════════════════════════════════════════════════════════
//  TIMELINE VIEW — Drag-to-resize component
// ═══════════════════════════════════════════════════════════════

function TimelineBar({
  entries,
  onResize,
}: {
  entries: TimeEntry[];
  onResize: (entryId: string, newMinutes: number) => Promise<void>;
}) {
  const totalMinutes = entries.reduce(
    (sum, e) => sum + (e.durationMinutes ?? 0),
    0,
  );
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoveredEntry, setHoveredEntry] = useState<string | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, entryId: string, currentMinutes: number) => {
      e.preventDefault();
      const startX = e.clientX;
      const startMinutes = currentMinutes;
      setDragging(entryId);

      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const deltaPx = ev.clientX - startX;
        const pxPerMinute = rect.width / Math.max(totalMinutes, 1);
        const deltaMinutes = Math.round(deltaPx / pxPerMinute);
        const newMinutes = Math.max(1, startMinutes + deltaMinutes);
        const bar = barRef.current.querySelector(
          `[data-entry-id="${entryId}"]`,
        ) as HTMLElement | null;
        if (bar) {
          const newPct = (newMinutes / Math.max(totalMinutes + deltaMinutes, 1)) * 100;
          bar.style.setProperty('--drag-width', `${Math.max(newPct, 2)}%`);
        }
      };

      const handleMouseUp = async (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const deltaPx = ev.clientX - startX;
        const pxPerMinute = rect.width / Math.max(totalMinutes, 1);
        const deltaMinutes = Math.round(deltaPx / pxPerMinute);
        const newMinutes = Math.max(1, startMinutes + deltaMinutes);
        setDragging(null);
        await onResize(entryId, newMinutes);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [totalMinutes, onResize],
  );

  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-surface-500 mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <Clock className="h-3 w-3" />
        Timeline
        <span className="text-surface-400 font-normal normal-case">
          — {formatDuration(totalMinutes)} total
        </span>
      </p>
      <div
        ref={barRef}
        className="bg-surface-200/50 relative flex h-8 w-full overflow-hidden rounded-xl"
      >
        {entries.map((entry, idx) => {
          const pct = Math.max(
            ((entry.durationMinutes ?? 0) / Math.max(totalMinutes, 1)) * 100,
            2,
          );
          const color = getEntryColor(idx);
          const isDraggingThis = dragging === entry.id;
          const isHovered = hoveredEntry === entry.id;
          return (
            <div
              key={entry.id}
              data-entry-id={entry.id}
              className="group relative h-full cursor-pointer transition-opacity"
              style={{
                width: isDraggingThis
                  ? 'var(--drag-width, 0%)'
                  : `${pct}%`,
                minWidth: '4px',
                backgroundColor: color,
                opacity: dragging && !isDraggingThis ? 0.4 : 0.85,
              }}
              onMouseEnter={() => setHoveredEntry(entry.id)}
              onMouseLeave={() => setHoveredEntry(null)}
            >
              {/* Resize handle — manual entries only. Timer entries are
                  non-editable (Phase 5); their duration PATCH returns 422
                  CORRECTION_REQUIRED, so we disable the handle and explain. */}
              {entry.entryType === 'timer' ? (
                <div
                  className="absolute right-0 top-0 z-10 flex h-full w-2 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                  title="Timer durations can't be dragged — submit a time-correction request to change them."
                >
                  <Ban className="h-2.5 w-2.5 text-white/60" />
                </div>
              ) : (
                <div
                  className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize opacity-0 transition-opacity group-hover:opacity-100 hover:!opacity-100"
                  style={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
                  onMouseDown={(e) =>
                    handleMouseDown(e, entry.id, entry.durationMinutes ?? 1)
                  }
                >
                  <div className="absolute inset-y-0 right-0 flex items-center justify-center">
                    <GripHorizontal className="h-2.5 w-2.5 text-white/60" />
                  </div>
                </div>
              )}
              {/* Tooltip on hover */}
              <AnimatePresence>
                {isHovered && !isDraggingThis && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-surface-900 absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1 shadow-lg"
                  >
                    <p className="text-surface-100 text-[10px] font-medium">
                      {entry.task.title} — {formatDuration(entry.durationMinutes ?? 0)}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      {/* Legend for timeline */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map((entry, idx) => (
          <span
            key={entry.id}
            className="flex items-center gap-1 text-[9px] text-surface-400"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: getEntryColor(idx) }}
            />
            <span className="truncate max-w-[80px]">{entry.task.title}</span>
            <span className="font-medium">{formatDuration(entry.durationMinutes ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export default function TimeTrackingPage() {
  // ── Custom hooks ────────────────────────────────────────
  const [scope, setScope] = useState<'today' | 'week' | 'month'>('today');
  const timeData = useTimeEntries(scope);
  const timer = useRunningTimer();
  const taskSearch = useTaskSearch();
  const {
    shift,
    shiftOpen,
    shiftLoading,
    clockIn,
    clockOut,
    refresh: refreshShift,
  } = useCurrentShift();

  // Manual log dialog
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const [logMinutes, setLogMinutes] = useState('');
  const [logDescription, setLogDescription] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // ── Correction requests ────────────────────────────────
  const [correctionRequests, setCorrectionRequests] = useState<
    Array<{
      id: string;
      timeEntryId: string;
      userId: string;
      taskId: string;
      originalMinutes: number;
      requestedMinutes: number;
      reason: string;
      status: string;
      reviewNote?: string | null;
      createdAt: string;
      user: { id: string; name: string | null; email: string };
      task: { id: string; title: string; taskIdDisplay: string };
    }>
  >([]);
  const [pendingCorrectionCount, setPendingCorrectionCount] = useState(0);
  const [correctionRequestsLoading, setCorrectionRequestsLoading] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [correctionEntryId, setCorrectionEntryId] = useState<string | null>(null);
  const [correctionCurrentMinutes, setCorrectionCurrentMinutes] = useState(0);
  const [correctionMinutes, setCorrectionMinutes] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [showCorrections, setShowCorrections] = useState(false);

  const { entries, summary, taskBreakdown, total, loading, error, refresh: refreshEntries } = timeData;
  const { runningTimer, timerElapsed, timerLoading, startTimer, stopTimer, refresh: refreshTimer } = timer;
  const {
    query: searchQuery,
    results: searchResults,
    loading: searchLoading,
    search: handleSearchChange,
    clear: clearSearch,
  } = taskSearch;

  const refresh = useCallback(() => {
    refreshEntries();
    refreshTimer();
    refreshShift();
  }, [refreshEntries, refreshTimer, refreshShift]);
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Idle detection ───────────────────────────────────────
  const lastActivityRef = useRef<number>(Date.now());
  const idleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [idleSeconds, setIdleSeconds] = useState<number | null>(null);
  const { toast } = useToast();

  // Track user activity
  useEffect(() => {
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
      setIdleSeconds(null);
    };
    window.addEventListener('mousemove', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });
    window.addEventListener('touchstart', updateActivity, { passive: true });
    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('scroll', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
    };
  }, []);

  // Idle check interval when timer is running
  useEffect(() => {
    if (runningTimer?.running) {
      idleCheckRef.current = setInterval(() => {
        const idleTime = Date.now() - lastActivityRef.current;
        const idleSec = Math.floor(idleTime / 1000);
        const remainingSec = Math.max(0, Math.floor((IDLE_TIMEOUT_MS - idleTime) / 1000));

        // Update idle countdown for UI (show when > 30s idle)
        if (idleSec > 30) {
          setIdleSeconds(remainingSec);
        }

        // Auto-stop if idle for 15 minutes
        if (idleTime >= IDLE_TIMEOUT_MS) {
          if (idleCheckRef.current) {
            clearInterval(idleCheckRef.current);
            idleCheckRef.current = null;
          }
          setIdleSeconds(null);
          // Auto-stop the timer
          const doAutoStop = async () => {
            if (!runningTimer?.entry) return;
            await stopTimer(runningTimer.entry.id, runningTimer.entry.taskId);
            refresh();
            toast({
              title: 'Timer auto-paused',
              description: 'Auto-paused due to 15 minutes of inactivity.',
            });
          };
          doAutoStop();
        }
      }, IDLE_CHECK_INTERVAL_MS);
    }

    return () => {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
      setIdleSeconds(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTimer?.running]);

  // ── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setScope('today');
      else if (e.key === '2') setScope('week');
      else if (e.key === '3') setScope('month');
      else if (e.key === 't' || e.key === 'T') {
        if (!runningTimer?.running) setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stop timer handler ─────────────────────────────────
  const handleStopTimer = useCallback(async () => {
    if (!runningTimer?.entry) return;
    await stopTimer(runningTimer.entry.id, runningTimer.entry.taskId);
    refresh();
  }, [runningTimer, stopTimer, refresh]);

  // ── Shift clock in/out ─────────────────────────────────
  const handleClockIn = useCallback(async () => {
    const ok = await clockIn();
    if (ok) {
      toast({ title: 'Clocked in', description: 'Your shift is now open.' });
    } else {
      toast({ title: 'Failed to clock in', variant: 'error' });
    }
  }, [clockIn, toast]);

  const handleClockOut = useCallback(async () => {
    const ok = await clockOut();
    if (ok) {
      // Clock-out auto-stops a running timer server-side; refresh everything.
      refresh();
      toast({ title: 'Clocked out', description: 'Your shift is closed. Any running timer was stopped.' });
    } else {
      toast({ title: 'Failed to clock out', variant: 'error' });
    }
  }, [clockOut, refresh, toast]);

  // Block starting a task timer without an open shift (the POST returns 422
  // NO_OPEN_SHIFT). Surface a clear "Clock in first" message instead.
  const handleStartTimer = useCallback(
    (taskId: string) => {
      if (!shiftOpen) {
        toast({
          title: 'Clock in first',
          description: 'Open a shift before starting a task timer.',
          variant: 'error',
        });
        return false;
      }
      startTimer(taskId);
      return true;
    },
    [shiftOpen, startTimer, toast],
  );

  // ── Resize time entry (drag-to-resize) ──────────────────
  const handleResizeEntry = useCallback(
    async (entryId: string, newMinutes: number) => {
      // Find the entry to get its taskId
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return;
      try {
        const res = await fetch(
          `/api/tasks/${entry.taskId}/time-entries?entryId=${entryId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ durationMinutes: newMinutes }),
          },
        );
        if (!res.ok) throw new Error('Failed to resize');
        refresh();
      } catch (err) {
        console.error('Failed to resize time entry:', err);
      }
    },
    [entries, refresh],
  );

  // ── Delete time entry ───────────────────────────────────
  const deleteEntry = useCallback(async (entry: TimeEntry) => {
    try {
      const res = await fetch(
        `/api/tasks/${entry.taskId}/time-entries?entryId=${entry.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to delete time entry');
      refresh();
    } catch (err) {
      console.error('Failed to delete time entry:', err);
    }
  }, [refresh]);

  // ── Manual log ──────────────────────────────────────────
  const handleManualLog = useCallback(async () => {
    if (!logTaskId || !logMinutes) return;
    const mins = parseInt(logMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      setLogError('Enter a valid duration in minutes');
      return;
    }

    setLogLoading(true);
    setLogError(null);
    try {
      const res = await fetch(`/api/tasks/${logTaskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType: 'manual',
          durationMinutes: mins,
          description: logDescription || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to log time');
      }
      setLogDialogOpen(false);
      setLogMinutes('');
      setLogDescription('');
      setLogTaskId(null);
      refresh();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to log time');
    } finally {
      setLogLoading(false);
    }
  }, [logTaskId, logMinutes, logDescription, refresh]);

  // ── Fetch correction requests ──────────────────────────
  const fetchCorrectionRequests = useCallback(async () => {
    setCorrectionRequestsLoading(true);
    try {
      const res = await fetch('/api/time-corrections?limit=50');
      if (res.ok) {
        const data = await res.json();
        setCorrectionRequests(data.requests ?? []);
        setPendingCorrectionCount(data.pendingCount ?? 0);
      }
    } catch {
      // Silently fail
    } finally {
      setCorrectionRequestsLoading(false);
    }
  }, []);

  // Fetch corrections on mount and when tab re-visits
  useEffect(() => {
    fetchCorrectionRequests();
  }, [fetchCorrectionRequests]);

  // ── Submit correction request ──────────────────────────
  const handleSubmitCorrection = useCallback(async () => {
    if (!correctionEntryId || !correctionMinutes) return;
    const mins = parseInt(correctionMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      setCorrectionError('Enter a valid duration in minutes');
      return;
    }
    if (!correctionReason.trim()) {
      setCorrectionError('Please provide a reason for the correction');
      return;
    }

    setCorrectionLoading(true);
    setCorrectionError(null);
    try {
      const res = await fetch('/api/time-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeEntryId: correctionEntryId,
          requestedMinutes: mins,
          reason: correctionReason.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to submit correction request');
      }
      setCorrectionDialogOpen(false);
      setCorrectionMinutes('');
      setCorrectionReason('');
      setCorrectionEntryId(null);
      toast({
        title: 'Correction requested',
        description: 'Your manager has been notified for approval.',
      });
      refresh();
      fetchCorrectionRequests();
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setCorrectionLoading(false);
    }
  }, [correctionEntryId, correctionMinutes, correctionReason, refresh, fetchCorrectionRequests, toast]);

  // ── Approve correction request ─────────────────────────
  const handleApproveCorrection = useCallback(async (correctionId: string) => {
    setReviewingId(correctionId);
    try {
      const res = await fetch(`/api/time-corrections?id=${encodeURIComponent(correctionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!res.ok) throw new Error('Failed to approve');
      toast({
        title: 'Correction approved',
        description: 'The time entry has been updated.',
      });
      refresh();
      fetchCorrectionRequests();
    } catch {
      toast({
        title: 'Failed to approve',
        description: 'Please try again.',
      });
    } finally {
      setReviewingId(null);
    }
  }, [refresh, fetchCorrectionRequests, toast]);

  // ── Reject correction request ──────────────────────────
  const handleRejectCorrection = useCallback(async (correctionId: string) => {
    setReviewingId(correctionId);
    try {
      const res = await fetch(`/api/time-corrections?id=${encodeURIComponent(correctionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      toast({
        title: 'Correction rejected',
        description: 'The request has been rejected.',
      });
      fetchCorrectionRequests();
    } catch {
      toast({
        title: 'Failed to reject',
        description: 'Please try again.',
      });
    } finally {
      setReviewingId(null);
    }
  }, [fetchCorrectionRequests, toast]);

  // ── Cancel own correction request ──────────────────────
  const handleCancelCorrection = useCallback(async (correctionId: string) => {
    setReviewingId(correctionId);
    try {
      const res = await fetch(`/api/time-corrections?id=${encodeURIComponent(correctionId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to cancel');
      toast({
        title: 'Correction cancelled',
        description: 'Your correction request has been withdrawn.',
      });
      fetchCorrectionRequests();
    } catch {
      toast({
        title: 'Failed to cancel',
        description: 'Please try again.',
      });
    } finally {
      setReviewingId(null);
    }
  }, [fetchCorrectionRequests, toast]);

  // ── Open correction dialog ─────────────────────────────
  const openCorrectionDialog = useCallback((entry: TimeEntry) => {
    setCorrectionEntryId(entry.id);
    setCorrectionCurrentMinutes(entry.durationMinutes ?? 0);
    setCorrectionMinutes(String(entry.durationMinutes ?? 0));
    setCorrectionReason('');
    setCorrectionError(null);
    setCorrectionDialogOpen(true);
  }, []);

  // ── Task search ─────────────────────────────────────────
  const handleSearch = useCallback((q: string) => {
    handleSearchChange(q);
  }, [handleSearchChange]);

  // ── Format timer display ────────────────────────────────
  function formatTimerElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ── Group entries by date ───────────────────────────────
  const groupedByDate = entries.reduce<
    Record<string, { entries: TimeEntry[]; totalMinutes: number }>
  >((acc, entry) => {
    const dateKey = new Date(entry.startTime).toDateString();
    if (!acc[dateKey]) {
      acc[dateKey] = { entries: [], totalMinutes: 0 };
    }
    acc[dateKey]!.entries.push(entry);
    acc[dateKey]!.totalMinutes += entry.durationMinutes ?? 0;
    return acc;
  }, {});

  // ── Today's entries for timeline (only 'today' scope) ───
  const timelineEntries = scope === 'today' ? entries : [];

  // ── Build correction status map by timeEntryId ───────────
  const correctionStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; requestedMinutes: number }>();
    for (const req of correctionRequests) {
      // Only keep the most recent request per entry (first in array since API returns newest first)
      if (!map.has(req.timeEntryId)) {
        map.set(req.timeEntryId, {
          status: req.status,
          requestedMinutes: req.requestedMinutes,
        });
      }
    }
    return map;
  }, [correctionRequests]);

  // ── Render correction status badge ──────────────────────
  function renderCorrectionBadge(entryId: string) {
    const correction = correctionStatusMap.get(entryId);
    if (!correction) return null;
    const isPending = correction.status === 'pending';
    const isApproved = correction.status === 'approved';
    const isCancelled = correction.status === 'cancelled';
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
          isPending
            ? 'bg-amber-500/10 text-amber-500'
            : isApproved
              ? 'bg-success/10 text-success'
              : isCancelled
                ? 'bg-surface-500/10 text-surface-500'
                : 'bg-error/10 text-error'
        }`}
      >
        {isPending ? 'Pending' : isApproved ? 'Approved' : isCancelled ? 'Cancelled' : 'Rejected'}
        <FileEdit className="h-2.5 w-2.5" />
      </span>
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-surface-900 text-2xl font-bold tracking-tight">
            Time Tracking
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            Track and manage your time across tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Shift clock in/out — a task timer can't start without an open shift */}
          {shiftOpen ? (
            <div className="flex items-center gap-2">
              <Badge variant="success" size="sm" className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                On shift{shift?.clockIn ? ` since ${formatTime(shift.clockIn)}` : ''}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClockOut}
                disabled={shiftLoading}
                className="h-8 rounded-lg px-2.5 text-xs"
              >
                {shiftLoading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="mr-1 h-3.5 w-3.5" />
                )}
                Clock Out
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClockIn}
              disabled={shiftLoading}
              className="h-8 rounded-lg px-2.5 text-xs"
            >
              {shiftLoading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clock className="mr-1 h-3.5 w-3.5" />
              )}
              Clock In
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setLogDialogOpen(true); setLogTaskId(null); }}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Log Time
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (!shiftOpen) {
                toast({
                  title: 'Clock in first',
                  description: 'Open a shift before starting a task timer.',
                  variant: 'error',
                });
                return;
              }
              setSearchOpen(true);
            }}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            Start Timer
          </Button>
        </div>
      </motion.div>

      {/* Running Timer Banner */}
      <AnimatePresence>
        {runningTimer?.running && runningTimer.entry && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-surface-50 border-brand-500/20 rounded-2xl border p-5 shadow-sm"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="bg-brand-500 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
                    <Timer className="h-7 w-7 text-white" />
                  </div>
                  <span className="absolute -right-1 -top-1 flex h-3 w-3">
                    <span className="bg-green-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                    <span className="bg-green-500 relative inline-flex h-3 w-3 rounded-full" />
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-surface-900 text-lg font-bold tabular-nums">
                      {formatTimerElapsed(timerElapsed)}
                    </span>
                    <Badge variant="success" size="sm" className="animate-pulse">
                      Tracking
                    </Badge>
                    <AnimatePresence>
                      {idleSeconds !== null && idleSeconds < 120 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                        >
                          <Badge variant="warning" size="sm" className="flex items-center gap-1">
                            <Moon className="h-2.5 w-2.5" />
                            {idleSeconds > 60
                              ? `${Math.floor(idleSeconds / 60)}m`
                              : `${idleSeconds}s`}{' '}
                            idle
                          </Badge>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <Link
                    href={`/tasks/${runningTimer.entry.taskId}`}
                    className="text-surface-500 hover:text-brand-500 mt-0.5 inline-flex items-center gap-1 text-sm font-medium transition-colors"
                  >
                    {runningTimer.entry.task.title}
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                  {runningTimer.entry.description && (
                    <p className="text-surface-500 mt-0.5 text-xs">
                      {runningTimer.entry.description}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopTimer}
                disabled={timerLoading}
                className="shrink-0 rounded-lg"
              >
                {timerLoading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="mr-1 h-3.5 w-3.5" />
                )}
                Stop
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary Cards */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        {[
          { label: 'Total Hours', value: summary?.totalHours ?? '0.0', sub: 'hours tracked', icon: Clock, gradient: 'from-blue-500 to-blue-400', iconBg: 'bg-blue-500/10 text-blue-400' },
          { label: 'Sessions', value: summary?.entryCount ?? 0, sub: 'time entries', icon: BarChart3, gradient: 'from-amber-500 to-yellow-400', iconBg: 'bg-amber-500/10 text-amber-400' },
          { label: 'Avg Session', value: summary ? formatDuration(summary.avgSessionMinutes) : '0m', sub: 'per entry', icon: TrendingUp, gradient: 'from-purple-500 to-violet-400', iconBg: 'bg-purple-500/10 text-purple-400' },
          { label: 'Tasks', value: taskBreakdown.length, sub: 'tasks with time', icon: ListTodo, gradient: 'from-green-500 to-emerald-400', iconBg: 'bg-green-500/10 text-green-400' },
        ].map((card) => (
          <motion.div key={card.label} variants={itemVariants}>
            <motion.div
              whileHover={{ y: -2 }}
              className="border-surface-300/20 bg-surface-100/80 hover:border-brand-500/30 group relative overflow-hidden rounded-2xl border p-4 transition-all duration-200 hover:shadow-sm"
            >
              <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${card.gradient} opacity-60`} />
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <p className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                    {card.label}
                  </p>
                  <p className="text-surface-900 text-2xl font-bold tabular-nums">
                    {card.value}
                  </p>
                  <p className="text-surface-500 text-xs">{card.sub}</p>
                </div>
                <div className={`rounded-xl p-2 ${card.iconBg} transition-all duration-300 group-hover:scale-110 group-hover:shadow-sm`}>
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Pending Corrections Section */}
      {pendingCorrectionCount > 0 && (
        <motion.div variants={itemVariants}>
          <motion.div
            initial={false}
            className="border-amber-500/20 bg-amber-500/5 overflow-hidden rounded-2xl border"
          >
            <button
              onClick={() => setShowCorrections(!showCorrections)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <FileEdit className="text-amber-500 h-4 w-4" />
                <span className="text-surface-900 text-sm font-semibold">
                  Pending Corrections
                </span>
                <span className="bg-amber-500/15 text-amber-500 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {pendingCorrectionCount}
                </span>
              </div>
              <ChevronRight
                className={`text-surface-400 h-4 w-4 transition-transform duration-200 ${
                  showCorrections ? 'rotate-90' : ''
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {showCorrections && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-amber-500/10 space-y-2 border-t px-4 pb-4 pt-3">
                    {correctionRequestsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="text-surface-400 h-4 w-4 animate-spin" />
                      </div>
                    ) : correctionRequests.filter((r) => r.status === 'pending').length === 0 ? (
                      <p className="text-surface-500 py-3 text-center text-sm">No pending requests.</p>
                    ) : (
                      correctionRequests
                        .filter((r) => r.status === 'pending')
                        .map((req) => (
                          <motion.div
                            key={req.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-surface-100/80 flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-surface-900 text-sm font-medium">
                                  {req.user.name ?? req.user.email}
                                </span>
                                <Badge variant="warning" size="sm">Pending</Badge>
                              </div>
                              <p className="text-surface-500 mt-0.5 text-xs">
                                {req.task.taskIdDisplay} —{' '}
                                {req.originalMinutes}m → {req.requestedMinutes}m
                              </p>
                              {req.reason && (
                                <p className="text-surface-500 mt-0.5 text-xs italic">
                                  &ldquo;{req.reason}&rdquo;
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                onClick={() => handleApproveCorrection(req.id)}
                                disabled={reviewingId === req.id}
                                className="bg-success/10 text-success hover:bg-success/20 rounded-lg p-1.5 transition-all"
                                title="Approve"
                              >
                                {reviewingId === req.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ThumbsUp className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => handleRejectCorrection(req.id)}
                                disabled={reviewingId === req.id}
                                className="bg-error/10 text-error hover:bg-error/20 rounded-lg p-1.5 transition-all"
                                title="Reject"
                              >
                                <ThumbsDown className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleCancelCorrection(req.id)}
                                disabled={reviewingId === req.id}
                                className="bg-surface-500/10 text-surface-500 hover:bg-surface-500/20 rounded-lg p-1.5 transition-all"
                                title="Cancel (withdraw request)"
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            </div>
                          </motion.div>
                        )))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}

      {/* Timeline View (today only) */}
      {timelineEntries.length > 1 && (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className="p-5">
              <TimelineBar
                entries={timelineEntries}
                onResize={handleResizeEntry}
              />
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Scope Tabs + Content */}
      <motion.div variants={itemVariants}>
        <Card className="neon-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="text-surface-400 h-4 w-4" />
                Time Log
              </CardTitle>
              <div className="border-surface-300/20 flex gap-0.5 rounded-xl border p-0.5">
                {(['today', 'week', 'month'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                      scope === s
                        ? 'bg-brand-400 text-white shadow-sm'
                        : 'text-surface-500 hover:text-surface-700 hover:bg-surface-200/50 '
                    }`}
                  >
                    {s === 'today' ? 'Today' : s === 'week' ? 'This Week' : 'This Month'}
                  </button>
                ))}
              </div>
              <kbd className="bg-surface-200/50 text-surface-500 hidden rounded-md px-1.5 py-0.5 text-[10px] font-mono md:inline-block">
                1-2-3
              </kbd>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-surface-500 text-xs font-medium">
                {total} entries
              </span>
              <button
                onClick={refresh}
                aria-label="Refresh entries"
                className="text-surface-500 hover:text-surface-700 hover:bg-surface-200/50 rounded-lg p-1.5 transition-all"
              >
                <Loader2 className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="text-surface-400 h-6 w-6 animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center py-12">
                <AlertCircle className="text-error mb-2 h-8 w-8" />
                <p className="text-error text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={refreshEntries}>
                  Retry
                </Button>
              </div>
            ) : entries.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center py-16 text-center"
              >
                <div className="neon-card mb-5 flex h-20 w-20 items-center justify-center rounded-3xl">
                  <Clock className="text-surface-400 h-9 w-9" />
                </div>
                <h3 className="text-surface-900 text-lg font-semibold">
                  No time entries yet
                </h3>
                <p className="text-surface-500 mt-1.5 max-w-sm text-sm leading-relaxed">
                  Tracking your time helps you understand where your hours go. Start a timer when you begin working, or log time manually afterward.
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <Button size="sm" onClick={() => {
                    if (!shiftOpen) {
                      toast({
                        title: 'Clock in first',
                        description: 'Open a shift before starting a task timer.',
                        variant: 'error',
                      });
                      return;
                    }
                    setSearchOpen(true);
                  }} className="h-8 rounded-lg px-3 text-xs">
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    Start Timer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setLogDialogOpen(true); setLogTaskId(null); }}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Log Manually
                  </Button>
                </div>
              </motion.div>
            ) : (
              <div className="space-y-6">
                {/* Task breakdown */}
                {taskBreakdown.length > 0 && (
                  <div className="border-surface-300/20 rounded-xl border p-4">
                    <p className="text-surface-500 mb-3 text-xs font-semibold uppercase tracking-wider">
                      Breakdown by Task
                    </p>
                    <div className="space-y-2">
                      {taskBreakdown.slice(0, 8).map((bt, idx) => {
                        const maxMinutes = taskBreakdown[0]?.totalMinutes ?? 1;
                        const pct = Math.round((bt.totalMinutes / maxMinutes) * 100);
                        return (
                          <motion.div
                            key={bt.taskId}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.04 }}
                            className="flex items-center gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <Link
                                  href={`/tasks/${bt.taskId}`}
                                  className="text-surface-700 hover:text-brand-500 truncate text-sm font-medium transition-colors"
                                >
                                  {bt.title}
                                </Link>
                                <span className="text-surface-500 ml-2 shrink-0 text-xs tabular-nums">
                                  {formatDuration(bt.totalMinutes)}
                                </span>
                              </div>
                              <div className="bg-surface-200/50 mt-1 h-1.5 w-full overflow-hidden rounded-full">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${pct}%` }}
                                  transition={{ duration: 0.6, ease: 'easeOut', delay: idx * 0.04 }}
                                  className="bg-brand-500 h-full rounded-full"
                                />
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Entries by date */}
                {Object.entries(groupedByDate).map(([dateKey, group]) => (
                  <div key={dateKey}>
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <Calendar className="text-surface-400 h-3.5 w-3.5" />
                      <span className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                        {formatDate(dateKey)}
                      </span>
                      <span className="text-surface-500 text-xs">
                        — {formatDuration(group.totalMinutes)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <AnimatePresence>
                        {group.entries.map((entry, idx) => (
                          <motion.div
                            key={entry.id}
                            custom={idx}
                            variants={entryVariants}
                            initial="hidden"
                            animate="visible"
                            exit="hidden"
                            layout
                            className="group border-surface-300/20 hover:bg-surface-100/80 flex items-center gap-3 rounded-xl border px-4 py-3 transition-all"
                          >
                            <div className="bg-brand-500/10 text-brand-500 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                              {entry.entryType === 'timer' ? (
                                <Play className="h-4 w-4" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/tasks/${entry.taskId}`}
                                  className="text-surface-700 hover:text-brand-500 truncate text-sm font-medium transition-colors"
                                >
                                  {entry.task.title}
                                </Link>
                                <Badge
                                  variant="default"
                                  size="sm"
                                  className={`shrink-0 ${
                                    statusColors[entry.task.status] ?? 'bg-surface-200 text-surface-500'
                                  }`}
                                >
                                  {statusLabels[entry.task.status] ?? entry.task.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-surface-500">
                                <span>{formatTime(entry.startTime)}</span>
                                {entry.endTime && (
                                  <>
                                    <span>→</span>
                                    <span>{formatTime(entry.endTime)}</span>
                                  </>
                                )}
                                {entry.entryType === 'timer' && entry.endTime && (
                                  <>
                                    <span className="text-surface-400">·</span>
                                    <span>{timeAgo(entry.createdAt)}</span>
                                  </>
                                )}
                              </div>
                              {entry.description && (
                                <p className="text-surface-500 mt-0.5 truncate text-xs">
                                  {entry.description}
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 text-right flex items-center gap-1.5">
                              {/* Correction status badge */}
                              {renderCorrectionBadge(entry.id)}
                              <p className="text-surface-900 text-sm font-medium tabular-nums">
                                {entry.durationMinutes != null
                                  ? formatDuration(entry.durationMinutes)
                                  : '—'}
                              </p>
                            </div>

                            <button
                              onClick={() => openCorrectionDialog(entry)}
                              className="text-surface-400 hover:text-amber-500 hover:bg-amber-500/5 rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100"
                              title="Request correction"
                            >
                              <Pen className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => deleteEntry(entry)}
                              className="text-surface-400 hover:text-error hover:bg-error/5 rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Task Search Dialog (Start Timer) ─────────────────── */}

      {/* ── Manual Log Dialog ──────────────────────────────── */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[15vh]"
            onClick={() => setSearchOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: -20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: -20 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-lg rounded-2xl border p-4 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative mb-3">
                <Search className="text-surface-400 absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search tasks to start timer..."
                  autoFocus
                  className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border py-3 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2"
                />
                {searchLoading && (
                  <Loader2 className="text-surface-400 absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" />
                )}
              </div>

              <div className="max-h-64 space-y-1 overflow-y-auto">
                {searchResults.length === 0 && searchQuery.trim() && !searchLoading ? (
                  <p className="text-surface-500 py-8 text-center text-sm">
                    No tasks found for &ldquo;{searchQuery}&rdquo;
                  </p>
                ) : searchResults.length === 0 && !searchQuery ? (
                  <p className="text-surface-500 py-8 text-center text-sm">
                    Type to search for a task
                  </p>
                ) : (
                  searchResults.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => {
                        handleStartTimer(task.id);
                        setSearchOpen(false);
                        clearSearch();
                      }}
                      disabled={timerLoading}
                      className="hover:bg-surface-200/50 text-surface-700 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors"
                    >
                      <div className="bg-brand-500/10 text-brand-500 flex h-8 w-8 items-center justify-center rounded-lg">
                        <Play className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{task.title}</p>
                        <p className="text-surface-500 text-xs">{task.taskIdDisplay}</p>
                      </div>
                      <Badge
                        variant="default"
                        size="sm"
                        className={`shrink-0 ${
                          statusColors[task.status] ?? 'bg-surface-200 text-surface-500'
                        }`}
                      >
                        {statusLabels[task.status] ?? task.status}
                      </Badge>
                    </button>
                  ))
                )}
              </div>

              <div className="border-surface-300/20 mt-3 flex items-center justify-between border-t pt-3">
                <p className="text-surface-500 text-xs">Select a task to start tracking</p>
                <button
                  onClick={() => setSearchOpen(false)}
                  className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Correction Request Dialog ──────────────────────── */}
      <AnimatePresence>
        {correctionDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setCorrectionDialogOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-md rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">Request Time Correction</h3>
                <button
                  onClick={() => setCorrectionDialogOpen(false)}
                  className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="border-surface-300/20 rounded-xl border p-3">
                  <p className="text-surface-500 text-xs">
                    Current duration: <span className="text-surface-900 font-semibold">{formatDuration(correctionCurrentMinutes)}</span>
                  </p>
                </div>

                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    New Duration (minutes) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={correctionMinutes}
                    onChange={(e) => setCorrectionMinutes(e.target.value)}
                    placeholder="e.g. 45"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                  {correctionCurrentMinutes > 0 && correctionMinutes && !isNaN(parseInt(correctionMinutes)) && (
                    <p className="text-surface-500 mt-1 text-xs">
                      {parseInt(correctionMinutes) > correctionCurrentMinutes
                        ? `Increase of ${parseInt(correctionMinutes) - correctionCurrentMinutes}m`
                        : parseInt(correctionMinutes) < correctionCurrentMinutes
                          ? `Decrease of ${correctionCurrentMinutes - parseInt(correctionMinutes)}m`
                          : 'No change'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Reason *
                  </label>
                  <textarea
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Explain why this correction is needed..."
                    rows={3}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                <div className="bg-amber-500/5 text-amber-600 flex items-start gap-2 rounded-xl px-3 py-2 text-xs">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>This will notify your manager for approval. The time entry will be updated once approved.</p>
                </div>

                {correctionError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {correctionError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setCorrectionDialogOpen(false)} className="rounded-lg">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitCorrection}
                    disabled={correctionLoading || !correctionMinutes || !correctionReason.trim()}
                    className="rounded-lg"
                  >
                    {correctionLoading ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileEdit className="mr-1 h-3.5 w-3.5" />
                    )}
                    Request Correction
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Manual Log Dialog ──────────────────────────────── */}
      <AnimatePresence>
        {logDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setLogDialogOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-md rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">Log Time Manually</h3>
                <button
                  onClick={() => setLogDialogOpen(false)}
                  className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Task (optional — search below)
                  </label>
                  <TaskSearchSelect
                    onSelect={(taskId) => setLogTaskId(taskId)}
                    selectedId={logTaskId}
                  />
                </div>

                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Duration (minutes) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={logMinutes}
                    onChange={(e) => setLogMinutes(e.target.value)}
                    placeholder="e.g. 30"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={logDescription}
                    onChange={(e) => setLogDescription(e.target.value)}
                    placeholder="What did you work on?"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {logError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {logError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setLogDialogOpen(false)} className="rounded-lg">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleManualLog}
                    disabled={logLoading || !logMinutes}
                    className="rounded-lg"
                  >
                    {logLoading ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    )}
                    Log Time
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Task Search Select Component ──────────────────────────────

function TaskSearchSelect({
  onSelect,
  selectedId,
}: {
  onSelect: (taskId: string | null) => void;
  selectedId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; title: string; taskIdDisplay: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tasks?search=${encodeURIComponent(query)}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.tasks ?? []);
        }
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tasks..."
        className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
      />
      {loading && (
        <div className="flex items-center gap-2 px-2 py-1">
          <Loader2 className="text-surface-400 h-3 w-3 animate-spin" />
          <span className="text-surface-500 text-xs">Searching...</span>
        </div>
      )}
      {results.length > 0 && (
        <div className="border-surface-300/20 space-y-0.5 rounded-xl border p-1">
          {results.map((task) => (
            <button
              key={task.id}
              onClick={() => {
                onSelect(task.id);
                setQuery(task.title);
                setResults([]);
              }}
              className={`hover:bg-surface-200/50 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                selectedId === task.id ? 'bg-brand-500/10' : ''
              }`}
            >
              <span className="text-surface-700 flex-1 truncate font-medium">{task.title}</span>
              <span className="text-surface-500 shrink-0 text-xs">{task.taskIdDisplay}</span>
              {selectedId === task.id && (
                <CheckCircle2 className="text-brand-500 h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
      {selectedId && (
        <button
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
          className="text-surface-500 hover:text-surface-700 text-xs transition-colors"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}
