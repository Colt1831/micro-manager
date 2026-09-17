'use client';

import { useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  FileEdit,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Calendar,
  ChevronRight,
  UserCheck,
  CheckSquare,
  Square,
  ArrowUpDown,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CorrectionRequest {
  id: string;
  timeEntryId: string;
  userId: string;
  taskId: string;
  originalMinutes: number;
  requestedMinutes: number;
  reason: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
  task: { id: string; title: string; taskIdDisplay: string };
}

// ─── Helpers ────────────────────────────────────────────────

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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

const rowVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) =>
    ({
      opacity: 1,
      x: 0,
      transition: { delay: i * 0.03, type: 'spring', stiffness: 120, damping: 16 },
    } as const),
} as const;

// ─── Filter Config ──────────────────────────────────────────

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: '' },
  { key: 'pending', label: 'Pending', color: 'bg-amber-500/10 text-amber-500' },
  { key: 'approved', label: 'Approved', color: 'bg-success/10 text-success' },
  { key: 'rejected', label: 'Rejected', color: 'bg-error/10 text-error' },
  { key: 'cancelled', label: 'Cancelled', color: 'bg-surface-500/10 text-surface-500' },
];

const STATUS_BADGE: Record<string, { variant: 'warning' | 'success' | 'danger' | 'default'; label: string }> = {
  pending: { variant: 'warning', label: 'Pending' },
  approved: { variant: 'success', label: 'Approved' },
  rejected: { variant: 'danger', label: 'Rejected' },
  cancelled: { variant: 'default', label: 'Cancelled' },
} as const;

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

interface CorrectionsClientProps {
  /** Server-rendered requests; null means the server load failed and the client should fetch. */
  initialRequests: CorrectionRequest[] | null;
}

export function CorrectionsClient({ initialRequests }: CorrectionsClientProps) {
  const { toast } = useToast();
  // When the server provided data, first paint already has real content — skip
  // the loading skeleton and the entrance fade. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialRequests !== null);
  const [loading, setLoading] = useState(initialRequests === null);
  const [requests, setRequests] = useState<CorrectionRequest[]>(initialRequests ?? []);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [performingAction, setPerformingAction] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // ── Fetch corrections ────────────────────────────────────
  const fetchCorrections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/time-corrections?limit=100');
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests ?? []);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchCorrections();
    });
  }, [hadInitialData, fetchCorrections]);

  // ── Compute stats ────────────────────────────────────────
  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'pending').length;
    const approved = requests.filter((r) => r.status === 'approved').length;
    const rejected = requests.filter((r) => r.status === 'rejected').length;
    const cancelled = requests.filter((r) => r.status === 'cancelled').length;
    return { total: requests.length, pending, approved, rejected, cancelled };
  }, [requests]);

  // ── Filtered list ────────────────────────────────────────
  const filteredRequests = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  // ── Toggle select ────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allIds = filteredRequests.map((r) => r.id);
      // If all are selected, deselect all; otherwise select all
      const allSelected = allIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  }, [filteredRequests]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Cancel own request ────────────────────────────────
  const handleCancel = useCallback(
    async (id: string) => {
      setCancellingId(id);
      try {
        const res = await fetch(`/api/time-corrections?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error?.message ?? 'Failed to cancel');
        }
        toast({
          title: 'Cancelled',
          description: 'Correction request cancelled.',
        });
        fetchCorrections();
      } catch (err) {
        toast({
          title: 'Failed to cancel',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'error',
        });
      } finally {
        setCancellingId(null);
      }
    },
    [fetchCorrections, toast],
  );

  // ── Single action ────────────────────────────────────────
  const handleSingleAction = useCallback(
    async (id: string, status: 'approved' | 'rejected') => {
      setPerformingAction(id);
      try {
        const res = await fetch(`/api/time-corrections?id=${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error('Action failed');
        toast({
          title: status === 'approved' ? 'Approved' : 'Rejected',
          description: `Correction request ${status}.`,
        });
        fetchCorrections();
      } catch {
        toast({
          title: 'Action failed',
          description: 'Please try again.',
          variant: 'error',
        });
      } finally {
        setPerformingAction(null);
      }
    },
    [fetchCorrections, toast],
  );

  // ── Bulk action ──────────────────────────────────────────
  const handleBulkAction = useCallback(
    async (status: 'approved' | 'rejected') => {
      if (selectedIds.size === 0) return;
      setBulkActionLoading(true);
      try {
        const res = await fetch('/api/time-corrections/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: Array.from(selectedIds),
            status,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error?.message ?? 'Bulk action failed');
        }
        const data = await res.json();
        toast({
          title: `Bulk ${status}`,
          description: `${data.reviewedCount} request(s) ${status}.`,
        });
        setSelectedIds(new Set());
        fetchCorrections();
      } catch (err) {
        toast({
          title: 'Bulk action failed',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'error',
        });
      } finally {
        setBulkActionLoading(false);
      }
    },
    [selectedIds, fetchCorrections, toast],
  );

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setFilter('all');
      else if (e.key === '2') setFilter('pending');
      else if (e.key === '3') setFilter('approved');
      else if (e.key === '4') setFilter('rejected');
      else if (e.key === '5') setFilter('cancelled');
      else if ((e.key === 'a' || e.key === 'A') && selectedIds.size > 0) handleBulkAction('approved');
      else if ((e.key === 'r' || e.key === 'R') && selectedIds.size > 0) handleBulkAction('rejected');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, handleBulkAction]);

  // ── Loading state ────────────────────────────────────────
  if (loading && requests.length === 0) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-64 rounded-lg" />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer h-8 w-20 rounded-xl" />
          ))}
        </div>
        <div className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="shimmer mb-3 h-12 rounded-xl last:mb-0" />
          ))}
        </div>
      </div>
    );
  }

  const allSelected = filteredRequests.length > 0 && filteredRequests.every((r) => selectedIds.has(r.id));

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
          title="Time Corrections"
          subtitle="Review and manage time entry correction requests"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCorrections}
              className="h-8 rounded-lg px-2.5 text-xs"
            >
              <Loader2 className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          }
        />
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        {[
          { label: 'Total Requests', value: stats.total, gradient: 'from-blue-500 to-blue-400', iconBg: 'bg-blue-500/10 text-blue-400', icon: FileEdit },
          { label: 'Pending', value: stats.pending, gradient: 'from-amber-500 to-yellow-400', iconBg: 'bg-amber-500/10 text-amber-500', icon: Clock },
          { label: 'Approved', value: stats.approved, gradient: 'from-green-500 to-emerald-400', iconBg: 'bg-success/10 text-success', icon: CheckCircle2 },
          { label: 'Rejected', value: stats.rejected, gradient: 'from-red-500 to-rose-400', iconBg: 'bg-error/10 text-error', icon: XCircle },
          { label: 'Cancelled', value: stats.cancelled, gradient: 'from-surface-400 to-surface-300', iconBg: 'bg-surface-500/10 text-surface-500', icon: Ban },
        ].map((card) => (
          <motion.div key={card.label} variants={itemVariants}>
            <motion.div
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
                </div>
                <div className={`rounded-xl p-2 ${card.iconBg} transition-all duration-300 group-hover:scale-110 group-hover:shadow-sm`}>
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Filter Bar */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center justify-between">
          <div
            className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
            role="tablist"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => { setFilter(f.key); clearSelection(); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f.key
                    ? 'bg-surface-50 text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700 '
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <kbd className="bg-surface-200/50 text-surface-500 hidden rounded-md px-1.5 py-0.5 text-[10px] font-mono md:inline-block">
            1-2-3-4-5
          </kbd>
        </div>
      </motion.div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ y: -8 }}
              animate={{ y: 0 }}
              className="bg-brand-500/5 border-brand-500/20 flex items-center justify-between rounded-xl border px-4 py-2.5"
            >
              <div className="flex items-center gap-2">
                <CheckSquare className="text-brand-500 h-4 w-4" />
                <span className="text-surface-900 text-sm font-medium">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="text-surface-500 hover:text-surface-700 text-xs transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAction('approved')}
                  disabled={bulkActionLoading}
                  className="h-7 rounded-lg px-2.5 text-xs"
                >
                  {bulkActionLoading ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <ThumbsUp className="mr-1 h-3 w-3" />
                  )}
                  Approve All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAction('rejected')}
                  disabled={bulkActionLoading}
                  className="h-7 rounded-lg px-2.5 text-xs text-error hover:bg-error/5"
                >
                  {bulkActionLoading ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <ThumbsDown className="mr-1 h-3 w-3" />
                  )}
                  Reject All
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table Card */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            {filteredRequests.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="neon-card mb-5 flex h-20 w-20 items-center justify-center rounded-3xl">
                  <FileEdit className="text-surface-400 h-9 w-9" />
                </div>
                <h3 className="text-surface-900 text-lg font-semibold">
                  {filter === 'all'
                    ? 'No correction requests'
                    : filter === 'pending'
                      ? 'No pending corrections'
                      : filter === 'approved'
                        ? 'No approved corrections'
                        : filter === 'cancelled'
                          ? 'No cancelled corrections'
                          : 'No rejected corrections'}
                </h3>
                <p className="text-surface-500 mt-1.5 max-w-sm text-sm leading-relaxed">
                  {filter === 'all'
                    ? 'Users can request time corrections from the timer page. They will appear here for review.'
                    : filter === 'pending'
                      ? 'All pending requests have been reviewed. Change the filter to see other statuses.'
                      : `No ${filter === 'cancelled' ? 'cancelled' : 'rejected'} correction requests found.`}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-surface-300/20 border-b">
                      {/* Checkbox column */}
                      <th className="w-10 px-3 py-3">
                        <button
                          onClick={toggleSelectAll}
                          className="text-surface-400 hover:text-surface-600 transition-colors"
                        >
                          {allSelected ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                        <div className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          User
                        </div>
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                        Task
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <ArrowUpDown className="h-3 w-3" />
                          Duration Change
                        </div>
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell">
                        Reason
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-surface-500 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Date
                        </div>
                      </th>
                      <th className="w-24 px-3 py-3 text-right">
                        <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                          Actions
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filteredRequests.map((req, idx) => {
                        const badgeConfig = STATUS_BADGE[req.status] ?? { variant: 'default' as const, label: req.status };
                        return (
                          <motion.tr
                            key={req.id}
                            custom={idx}
                            variants={rowVariants}
                            initial="hidden"
                            animate="visible"
                            exit="hidden"
                            layout
                            className={`border-surface-300/20 group border-b transition-colors ${
                              selectedIds.has(req.id)
                                ? 'bg-brand-500/5 '
                                : 'hover:bg-surface-100/50 '
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="px-3 py-3">
                              <button
                                onClick={() => toggleSelect(req.id)}
                                className="text-surface-400 hover:text-surface-600 transition-colors"
                              >
                                {selectedIds.has(req.id) ? (
                                  <CheckSquare className="h-4 w-4 text-brand-500" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </button>
                            </td>

                            {/* User */}
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2.5">
                                <div className="bg-brand-500/10 text-brand-500 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
                                  {(req.user.name ?? req.user.email).charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-surface-900 text-sm font-medium leading-tight">
                                    {req.user.name ?? 'Unnamed'}
                                  </p>
                                  <p className="text-surface-500 text-[11px] leading-tight">
                                    {req.user.email}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Task */}
                            <td className="px-3 py-3">
                              <a
                                href={`/tasks/${req.taskId}`}
                                className="text-surface-700 hover:text-brand-500 block max-w-[200px] truncate text-sm font-medium transition-colors"
                              >
                                {req.task.title}
                              </a>
                              <span className="text-surface-500 text-[11px]">{req.task.taskIdDisplay}</span>
                            </td>

                            {/* Duration Change */}
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-surface-500 text-xs">{formatMinutes(req.originalMinutes)}</span>
                                <ChevronRight className="text-surface-400 h-3 w-3" />
                                <span className="text-surface-900 text-sm font-semibold">
                                  {formatMinutes(req.requestedMinutes)}
                                </span>
                                {req.requestedMinutes !== req.originalMinutes && (
                                  <span
                                    className={`text-[10px] font-medium ${
                                      req.requestedMinutes > req.originalMinutes
                                        ? 'text-success'
                                        : 'text-error'
                                    }`}
                                  >
                                    ({req.requestedMinutes > req.originalMinutes ? '+' : ''}
                                    {req.requestedMinutes - req.originalMinutes}m)
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Reason */}
                            <td className="px-3 py-3 hidden md:table-cell">
                              <p className="text-surface-600 max-w-[220px] truncate text-xs">
                                {req.reason}
                              </p>
                            </td>

                            {/* Status */}
                            <td className="px-3 py-3">
                              <Badge variant={badgeConfig.variant} size="sm">
                                {badgeConfig.label}
                              </Badge>
                            </td>

                            {/* Date */}
                            <td className="px-3 py-3 hidden md:table-cell">
                              <p className="text-surface-600 text-xs whitespace-nowrap">
                                {formatDateTime(req.createdAt)}
                              </p>
                            </td>

                            {/* Actions */}
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {req.status === 'pending' && (
                                  <>
                                    <button
                                      onClick={() => handleSingleAction(req.id, 'approved')}
                                      disabled={performingAction === req.id}
                                      className="bg-success/10 text-success hover:bg-success/20 rounded-lg p-1.5 transition-all"
                                      title="Approve"
                                    >
                                      {performingAction === req.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <ThumbsUp className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => handleSingleAction(req.id, 'rejected')}
                                      disabled={performingAction === req.id}
                                      className="bg-error/10 text-error hover:bg-error/20 rounded-lg p-1.5 transition-all"
                                      title="Reject"
                                    >
                                      <ThumbsDown className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleCancel(req.id)}
                                      disabled={cancellingId === req.id}
                                      className="bg-surface-500/10 text-surface-500 hover:bg-surface-500/20 rounded-lg p-1.5 transition-all"
                                      title="Cancel (owner only)"
                                    >
                                      {cancellingId === req.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Ban className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Keyboard shortcuts hint */}
      {filteredRequests.length > 0 && (
        <motion.div
          variants={itemVariants}
          className="flex items-center justify-center gap-3 text-[10px] text-surface-400"
        >
          <span>Filter:</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <kbd key={n} className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">
              {n}
            </kbd>
          ))}
          <span className="text-surface-300 ">·</span>
          <span>Bulk:</span>
          <kbd className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">A</kbd>
          <span>approve</span>
          <kbd className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">R</kbd>
          <span>reject</span>
        </motion.div>
      )}
    </motion.div>
  );
}
