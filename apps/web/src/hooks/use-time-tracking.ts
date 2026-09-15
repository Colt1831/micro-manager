'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────

export type TimeEntry = {
  id: string;
  taskId: string;
  userId: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  entryType: string;
  description: string | null;
  isApproved: boolean;
  createdAt: string;
  task: {
    id: string;
    title: string;
    taskIdDisplay: string;
    status: string;
    projectId: string | null;
  };
};

export type RunningTimer = {
  running: boolean;
  entry: TimeEntry | null;
};

export type Summary = {
  totalHours: string;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  avgSessionMinutes: number;
};

export type TaskBreakdown = {
  taskId: string;
  title: string;
  taskIdDisplay: string;
  status: string;
  totalMinutes: number;
  count: number;
};

// ─── Hook: Time entries data ───────────────────────────────

export function useTimeEntries(scope: 'today' | 'week' | 'month') {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [taskBreakdown, setTaskBreakdown] = useState<TaskBreakdown[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/time-entries?scope=${scope}&limit=100`);
      if (!res.ok) throw new Error('Failed to fetch time entries');
      const data = await res.json();
      setEntries(data.entries ?? []);
      setSummary(data.summary ?? null);
      setTaskBreakdown(data.taskBreakdown ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time entries');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const refresh = useCallback(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return { entries, summary, taskBreakdown, total, loading, error, refresh };
}

// ─── Hook: Running timer ───────────────────────────────────

export function useRunningTimer() {
  const [runningTimer, setRunningTimer] = useState<RunningTimer | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerLoading, setTimerLoading] = useState(false);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkRunningTimer = useCallback(async () => {
    try {
      const res = await fetch('/api/time-entries/running');
      if (res.ok) {
        const data = await res.json();
        setRunningTimer(data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  const updateTimerElapsed = useCallback(() => {
    if (runningTimer?.entry?.startTime) {
      const diff = Date.now() - new Date(runningTimer.entry.startTime).getTime();
      setTimerElapsed(Math.floor(diff / 1000));
    }
  }, [runningTimer]);

  // Set up interval when timer is running
  useEffect(() => {
    if (runningTimer?.running && runningTimer.entry) {
      updateTimerElapsed();
      timerIntervalRef.current = setInterval(updateTimerElapsed, 1000);
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [runningTimer, updateTimerElapsed]);

  // Initial check
  useEffect(() => {
    checkRunningTimer();
  }, [checkRunningTimer]);

  const startTimer = useCallback(async (taskId: string) => {
    setTimerLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryType: 'timer' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to start timer');
      }
      await checkRunningTimer();
    } catch (err) {
      console.error('Failed to start timer:', err);
    } finally {
      setTimerLoading(false);
    }
  }, [checkRunningTimer]);

  const stopTimer = useCallback(async (entryId: string, taskId: string) => {
    setTimerLoading(true);
    try {
      const res = await fetch(
        `/api/tasks/${taskId}/time-entries?entryId=${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) throw new Error('Failed to stop timer');
      setRunningTimer(null);
      setTimerElapsed(0);
    } catch (err) {
      console.error('Failed to stop timer:', err);
    } finally {
      setTimerLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    checkRunningTimer();
  }, [checkRunningTimer]);

  return { runningTimer, timerElapsed, timerLoading, startTimer, stopTimer, refresh };
}

// ─── Hook: Current shift (clock in/out) ────────────────────

export type CurrentShift = {
  id: string;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  source: string;
};

export function useCurrentShift() {
  const [shift, setShift] = useState<CurrentShift | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const loadShift = useCallback(async () => {
    try {
      const res = await fetch('/api/shifts/current');
      if (res.ok) {
        const data = await res.json();
        setShiftOpen(!!data.open);
        setShift(data.shift ?? null);
      }
    } catch {
      // Silently fail — surfaced via explicit clock-in/out actions.
    }
  }, []);

  useEffect(() => {
    loadShift();
  }, [loadShift]);

  const clockIn = useCallback(async () => {
    setShiftLoading(true);
    setShiftError(null);
    try {
      const res = await fetch('/api/shifts/current', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to clock in');
      }
      await loadShift();
      return true;
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'Failed to clock in');
      return false;
    } finally {
      setShiftLoading(false);
    }
  }, [loadShift]);

  const clockOut = useCallback(async () => {
    setShiftLoading(true);
    setShiftError(null);
    try {
      const res = await fetch('/api/shifts/current', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to clock out');
      }
      await loadShift();
      return true;
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'Failed to clock out');
      return false;
    } finally {
      setShiftLoading(false);
    }
  }, [loadShift]);

  return { shift, shiftOpen, shiftLoading, shiftError, clockIn, clockOut, refresh: loadShift };
}

// ─── Hook: Task search with debounce ───────────────────────

export function useTaskSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; title: string; taskIdDisplay: string; status: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tasks?search=${encodeURIComponent(q)}&limit=10`);
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
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  return { query, results, loading, search, clear };
}
