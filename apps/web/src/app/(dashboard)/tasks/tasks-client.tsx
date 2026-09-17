'use client';

import { useEffect, useState, useCallback, startTransition, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import {
  Search,
  Filter,
  Plus,
  MoreHorizontal,
  LayoutList,
  Columns3,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Download,
  CheckCheck,
  X,
  Eye,
  Trash2,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { KanbanBoard } from '@/components/tasks/kanban-board';
import { EmptyState } from '@/components/ui/state-display';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  taskIdDisplay: string;
  assignedTo: string | null;
  assignedToName?: string | null;
  projectId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByName: string | null;
};

export type User = { id: string; name: string | null; email: string };

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

/**
 * Priority is an ORDERED scale, so it is rendered as a weighted ramp rather than
 * five equally loud pills: low/medium recede to plain text, and only high and
 * above spend colour. When every level shouts, the urgent rows stop standing out.
 */
const priorityBadge: Record<string, { label: string; color: string }> = {
  none: {
    label: 'None',
    color: 'text-surface-500',
  },
  low: {
    label: 'Low',
    color: 'text-surface-600',
  },
  medium: {
    label: 'Medium',
    color: 'text-surface-700',
  },
  high: {
    label: 'High',
    color: 'text-warning font-semibold',
  },
  urgent: {
    label: 'Urgent',
    color: 'text-error font-semibold',
  },
  critical: {
    label: 'Critical',
    color: 'bg-error text-white font-semibold px-1.5 py-0.5 rounded-md',
  },
};

const statuses = [
  'draft',
  'open',
  'in_progress',
  'blocked',
  'under_review',
  'on_hold',
  'completed',
  'closed',
  'cancelled',
];

type ViewMode = 'list' | 'board';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

interface TasksClientProps {
  /** Server-rendered first page of tasks (default filters); null means the server load failed and the client should fetch. */
  initialTasks: Task[] | null;
  /** Server-rendered total task count for the default query. */
  initialTotal: number;
  /** Server-rendered users list (for bulk assign); empty when unavailable. */
  initialUsers: User[];
}

export function TasksClient({ initialTasks, initialTotal, initialUsers }: TasksClientProps) {
  // When the server provided the first page, first paint already has real rows.
  const [hadInitialData] = useState(() => initialTasks !== null);
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? []);
  const [loading, setLoading] = useState(initialTasks === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [deletedByFilter, setDeletedByFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const pageSize = 25;

  const { toast } = useToast();

  // Trash view
  const [showTrash, setShowTrash] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<
    'status' | 'priority' | 'assign' | 'delete' | null
  >(null);
  const [batchValue, setBatchValue] = useState('');
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [showBatchPermaDeleteConfirm, setShowBatchPermaDeleteConfirm] = useState(false);
  const [showBatchRestoreConfirm, setShowBatchRestoreConfirm] = useState(false);

  // Cross-page selection
  const [totalCount, setTotalCount] = useState(initialTotal);
  const [allSelectedMode, setAllSelectedMode] = useState(false);
  const [allMatchingIds, setAllMatchingIds] = useState<string[]>([]);
  const [fetchingAllIds, setFetchingAllIds] = useState(false);

  // Users for bulk assign
  const [users, setUsers] = useState<User[]>(initialUsers);

  // Export
  const [exporting, setExporting] = useState(false);

  const requestIdRef = useRef(0);

  const fetchTasks = useCallback(async () => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: view === 'board' ? '100' : String(pageSize),
        offset: String(view === 'board' ? 0 : page * pageSize),
      });
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (search) params.set('search', search);
      if (watchedOnly) params.set('watchedBy', 'me');
      if (showTrash) params.set('deleted', 'true');
      if (deletedByFilter) params.set('deletedBy', deletedByFilter);

      const res = await fetch(`/api/tasks?${params}`);
      if (id !== requestIdRef.current) return; // stale — discard
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      if (id !== requestIdRef.current) return;
      setTasks(data.tasks ?? []);
      setTotalCount(data.total ?? 0);
      // Exit cross-page selection mode when data refreshes (filters/pagination may have changed)
      setAllSelectedMode(false);
      setAllMatchingIds([]);
    } catch (err) {
      if (id === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      }
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [statusFilter, priorityFilter, deletedByFilter, page, search, view, watchedOnly, showTrash]);

  // Skip the mount fetch when the server already provided the first page; still
  // refetch on every filter/pagination/view change (fetchTasks identity changes).
  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    startTransition(() => {
      fetchTasks();
    });
  }, [fetchTasks]);

  // Fetch users for batch assign (seeded from the server on the fast path).
  useEffect(() => {
    if (hadInitialData) return;
    fetch('/api/users?limit=100')
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => {});
  }, [hadInitialData]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Permanent delete handler ──────────────────────────────

  const handlePermanentDelete = async (taskId: string) => {
    setDeletingId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/permanent`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to permanently delete task');
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setDeletingTask(null);
      toast({
        title: 'Task permanently deleted',
        description: 'The task has been permanently removed from the database.',
      });
    } catch (err) {
      console.error('Permanent delete failed:', err);
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
      fetchTasks();
    } finally {
      setDeletingId(null);
    }
  };

  // ── Restore handler ──────────────────────────────────────

  const handleRestore = async (taskId: string) => {
    setRestoringId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/restore`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to restore task');
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast({ title: 'Task restored', description: 'The task has been restored successfully.' });
    } catch (err) {
      console.error('Restore failed:', err);
      toast({
        title: 'Restore failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
      fetchTasks();
    } finally {
      setRestoringId(null);
    }
  };

  const handleStatusFilter = useCallback((val: string) => {
    setStatusFilter(val);
    setPage(0);
  }, []);
  const handlePriorityFilter = useCallback((val: string) => {
    setPriorityFilter(val);
    setPage(0);
  }, []);
  const handleDeletedByFilter = useCallback((val: string) => {
    setDeletedByFilter(val);
    setPage(0);
  }, []);

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: string) => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message ?? 'Failed to update task');
        }
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
      } catch (err) {
        console.error('Status update failed:', err);
        fetchTasks();
      }
    },
    [fetchTasks],
  );

  const handleReorder = useCallback(
    async (taskId: string, newStatus: string, orderedIds: string[]) => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, order: orderedIds }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message ?? 'Failed to reorder task');
        }
        // Reorder the local tasks array to match the new order
        setTasks((prev) => {
          const columnTasks = prev.filter((t) => t.status === newStatus);
          const otherTasks = prev.filter((t) => t.status !== newStatus);
          // Build a map for fast lookup
          const taskMap = new Map(columnTasks.map((t) => [t.id, t]));
          const reordered = orderedIds.map((id) => taskMap.get(id)!).filter(Boolean);
          return [...otherTasks, ...reordered];
        });
      } catch (err) {
        console.error('Reorder failed:', err);
        fetchTasks();
      }
    },
    [fetchTasks],
  );

  // ── Selection handlers ─────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tasks.length || allSelectedMode) {
      setSelectedIds(new Set());
      setAllSelectedMode(false);
      setAllMatchingIds([]);
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const handleSelectAllAcrossPages = useCallback(async () => {
    if (fetchingAllIds) return;
    setFetchingAllIds(true);
    try {
      const params = new URLSearchParams({
        fields: 'id',
        limit: '100',
      });
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (search) params.set('search', search);
      if (watchedOnly) params.set('watchedBy', 'me');
      if (showTrash) params.set('deleted', 'true');
      if (deletedByFilter) params.set('deletedBy', deletedByFilter);

      const res = await fetch(`/api/tasks?${params}`);
      if (!res.ok) throw new Error('Failed to fetch task IDs');
      const data = await res.json();
      const ids: string[] = data.ids ?? [];

      if (ids.length > 100) {
        toast({
          title: 'Too many tasks',
          description:
            'A maximum of 100 tasks can be processed at once. The first 100 will be selected.',
          variant: 'warning',
        });
        ids.splice(100);
      }

      setAllMatchingIds(ids);
      setSelectedIds(new Set(ids));
      setAllSelectedMode(true);
    } catch (err) {
      console.error('Failed to fetch all task IDs:', err);
      toast({
        title: 'Failed to select all tasks',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setFetchingAllIds(false);
    }
  }, [
    statusFilter,
    priorityFilter,
    deletedByFilter,
    search,
    watchedOnly,
    showTrash,
    fetchingAllIds,
    toast,
  ]);

  // ── Batch operations ──────────────────────────────────────

  const getEffectiveIds = () =>
    allSelectedMode && allMatchingIds.length > 0 ? allMatchingIds : Array.from(selectedIds);

  const executeBatch = async () => {
    if (!batchAction || !batchValue || selectedIds.size === 0) return;

    const effectiveIds = getEffectiveIds();
    if (effectiveIds.length === 0) return;

    setBatchProcessing(true);
    try {
      const res = await fetch('/api/tasks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: effectiveIds,
          action: batchAction,
          value: batchValue,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Batch operation failed');
      }

      const actionLabels: Record<string, string> = {
        change_status: 'status changed',
        change_priority: 'priority changed',
        assign: 'assigned',
        delete: 'deleted',
      };
      const actionLabel = actionLabels[batchAction ?? ''] ?? 'updated';
      toast({
        title: `${effectiveIds.length} task${effectiveIds.length !== 1 ? 's' : ''} ${actionLabel}`,
        description: 'Batch operation completed successfully.',
      });
      setSelectedIds(new Set());
      setBatchAction(null);
      setBatchValue('');
      fetchTasks();
    } catch (err) {
      console.error('Batch operation failed:', err);
      toast({
        title: 'Batch operation failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setBatchProcessing(false);
    }
  };

  const cancelBatch = () => {
    setBatchAction(null);
    setBatchValue('');
  };

  // ── Batch restore handler ─────────────────────────────────

  const handleBatchRestore = async () => {
    const effectiveIds = getEffectiveIds();
    if (effectiveIds.length === 0) return;

    setBatchProcessing(true);
    try {
      const res = await fetch('/api/tasks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: effectiveIds,
          action: 'restore',
          value: 'restore',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Batch restore failed');
      }

      toast({
        title: `${effectiveIds.length} task${effectiveIds.length !== 1 ? 's' : ''} restored`,
        description: 'The selected tasks have been restored successfully.',
      });
      setSelectedIds(new Set());
      setAllSelectedMode(false);
      setAllMatchingIds([]);
      fetchTasks();
    } catch (err) {
      console.error('Batch restore failed:', err);
      toast({
        title: 'Restore failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setBatchProcessing(false);
    }
  };

  // ── Batch permanent delete handler ────────────────────────

  const handleBatchPermanentDelete = async () => {
    const effectiveIds = getEffectiveIds();
    if (effectiveIds.length === 0) return;
    setShowBatchPermaDeleteConfirm(false);

    setBatchProcessing(true);
    try {
      const res = await fetch('/api/tasks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: effectiveIds,
          action: 'permanent_delete',
          value: 'permanent_delete',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Batch permanent delete failed');
      }

      toast({
        title: `${effectiveIds.length} task${effectiveIds.length !== 1 ? 's' : ''} permanently deleted`,
        description: 'The selected tasks have been permanently removed from the database.',
      });
      setSelectedIds(new Set());
      setAllSelectedMode(false);
      setAllMatchingIds([]);
      fetchTasks();
    } catch (err) {
      console.error('Batch permanent delete failed:', err);
      toast({
        title: 'Permanent delete failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    } finally {
      setBatchProcessing(false);
    }
  };

  // ── Export ────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ type: 'tasks' });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await fetch(`/api/reports/export?${params}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tasks-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const showPagination = view === 'list' && !loading && !error && tasks.length > 0;

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-3">
            <div className="from-brand-400/20 to-brand-600/20 ring-brand-500/10 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ring-1 sm:h-10 sm:w-10 sm:rounded-2xl">
              <ClipboardList className="text-brand-500 h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <h1 className="text-surface-900 text-xl font-bold tracking-tight sm:text-2xl">
                Tasks
              </h1>
              <p className="text-surface-500 mt-0.5 text-xs sm:text-sm">
                {loading ? 'Loading...' : `${totalCount} task${totalCount !== 1 ? 's' : ''} total`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={loading || exporting}
            title="Export tasks as CSV"
            className="btn-shine h-9 px-2 sm:h-auto sm:px-3"
          >
            <Download className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', exporting && 'animate-spin')} />
            <span className="hidden sm:inline ml-1 sm:ml-1.5">{exporting ? 'Exporting...' : 'Export'}</span>
          </Button>
          <Link href="/tasks/new">
            <Button className="btn-shine shadow-sm h-9 px-3 sm:h-auto sm:px-4">
              <Plus className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
              <span className="text-xs sm:text-sm">New Task</span>
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* Toolbar */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-surface-400 absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 sm:h-4 sm:w-4 sm:left-3.5" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 pl-8 text-xs sm:h-10 sm:pl-10 sm:text-sm"
          />
        </div>

        {/* Compact action buttons on mobile */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="h-9 px-2 sm:px-3">
            <Filter className="h-3.5 w-3.5 sm:mr-1.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Filters</span>
            {(statusFilter || priorityFilter || deletedByFilter) && (
              <span className="bg-brand-500 ml-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-medium text-white sm:ml-1.5 sm:h-5 sm:w-5 sm:text-[10px]">
                {(statusFilter ? 1 : 0) + (priorityFilter ? 1 : 0) + (deletedByFilter ? 1 : 0)}
              </span>
            )}
          </Button>

          {/* Watched toggle */}
          <button
            onClick={() => {
              setShowTrash(false);
              setWatchedOnly(!watchedOnly);
              setPage(0);
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-200 sm:gap-1.5 sm:rounded-xl sm:px-3',
              watchedOnly && !showTrash
                ? 'bg-brand-500/10 text-brand-500 border-brand-500/20 border'
                : 'text-surface-500 hover:text-surface-600 hover:bg-surface-200/50 border border-transparent',
            )}
          >
            <Eye className={cn('h-3.5 w-3.5', watchedOnly && !showTrash && 'fill-brand-500/20')} />
            <span className="hidden sm:inline">Watched</span>
            {watchedOnly && !showTrash && (
              <span className="bg-brand-500/15 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full sm:h-4 sm:w-4">
                <X
                  className="text-brand-500 h-2 w-2 sm:h-2.5 sm:w-2.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWatchedOnly(false);
                    setPage(0);
                  }}
                />
              </span>
            )}
          </button>

          {/* Trash toggle */}
          <button
            onClick={() => {
              setShowTrash(!showTrash);
              setWatchedOnly(false);
              setDeletedByFilter('');
              setPage(0);
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-200 sm:gap-1.5 sm:rounded-xl sm:px-3',
              showTrash
                ? 'bg-error/10 text-error border-error/20 border'
                : 'text-surface-500 hover:text-surface-600 hover:bg-surface-200/50 border border-transparent',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Trash</span>
            {showTrash && (
              <span className="bg-error/15 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full sm:h-4 sm:w-4">
                <X
                  className="text-error h-2 w-2 sm:h-2.5 sm:w-2.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTrash(false);
                    setDeletedByFilter('');
                    setPage(0);
                  }}
                />
              </span>
            )}
          </button>

          {/* View Toggle */}
          <div className="border-surface-300/20 bg-surface-100/80 flex items-center rounded-lg border p-0.5 sm:rounded-xl">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setView('list')}
              className={cn(
                'relative flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all duration-200 sm:gap-1.5 sm:rounded-lg sm:px-3',
                view === 'list'
                  ? 'text-white'
                  : 'text-surface-500 hover:text-surface-600 ',
              )}
            >
              {view === 'list' && (
                <motion.span
                  layoutId="viewToggleBg"
                  className="bg-brand-400 absolute inset-0 rounded-md sm:rounded-lg shadow-sm"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1 sm:gap-1.5">
                <LayoutList className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="max-sm:sr-only sm:inline">List</span>
              </span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setView('board')}
              className={cn(
                'relative flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all duration-200 sm:gap-1.5 sm:rounded-lg sm:px-3',
                view === 'board'
                  ? 'text-white'
                  : 'text-surface-500 hover:text-surface-600 ',
              )}
            >
              {view === 'board' && (
                <motion.span
                  layoutId="viewToggleBg"
                  className="bg-brand-400 absolute inset-0 rounded-md sm:rounded-lg shadow-sm"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1 sm:gap-1.5">
                <Columns3 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="max-sm:sr-only sm:inline">Board</span>
              </span>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Filter Panel */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          className="neon-card flex flex-wrap gap-4 rounded-2xl p-4"
        >
          <div className="space-y-1.5">
            <label className="text-surface-500 block text-xs font-semibold uppercase tracking-wider">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilter(e.target.value)}
              className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 rounded-xl border px-3 text-sm transition-all focus:outline-none focus:ring-2"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-surface-500 block text-xs font-semibold uppercase tracking-wider">
              Priority
            </label>
            <select
              value={priorityFilter}
              onChange={(e) => handlePriorityFilter(e.target.value)}
              className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 rounded-xl border px-3 text-sm transition-all focus:outline-none focus:ring-2"
            >
              <option value="">All Priorities</option>
              {Object.entries(priorityBadge).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          {showTrash && (
            <div className="space-y-1.5">
              <label className="text-surface-500 block text-xs font-semibold uppercase tracking-wider">
                Deleted By
              </label>
              <select
                value={deletedByFilter}
                onChange={(e) => handleDeletedByFilter(e.target.value)}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 rounded-xl border px-3 text-sm transition-all focus:outline-none focus:ring-2"
              >
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </motion.div>
      )}

      {/* Select All Across Pages Banner */}
      {!allSelectedMode &&
        selectedIds.size === tasks.length &&
        tasks.length > 0 &&
        totalCount > tasks.length &&
        view === 'list' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-brand-500/20 border bg-brand-500/5 rounded-2xl px-4 py-3"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="text-surface-600 text-sm">
                All{' '}
                <span className="text-surface-900 font-semibold">
                  {tasks.length}
                </span>{' '}
                task{tasks.length !== 1 ? 's' : ''} on this page are selected.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleSelectAllAcrossPages}
                  disabled={fetchingAllIds}
                  className="h-8 whitespace-nowrap rounded-lg text-xs"
                >
                  {fetchingAllIds ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                      Loading...
                    </span>
                  ) : (
                    <span>
                      Select all <span className="font-semibold">{Math.min(totalCount, 100)}</span>{' '}
                      task{Math.min(totalCount, 100) !== 1 ? 's' : ''}
                      {totalCount > 100 ? (
                        <span className="font-normal"> of {totalCount} </span>
                      ) : (
                        ' '
                      )}
                      across all pages
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        )}

      {/* Bulk Action Bar */}
      <AnimatePresence mode="wait">
        {selectedIds.size > 0 &&
          view === 'list' &&
          (showTrash ? (
            <motion.div
              key="trash-bulk"
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className="border-brand-500/20 border bg-brand-500/5 flex flex-wrap items-center gap-2 rounded-2xl p-3"
            >
              <span className="text-surface-600 mr-1 text-xs font-medium">
                <span className="text-brand-500 font-semibold">
                  {allSelectedMode ? totalCount : selectedIds.size}
                </span>
                {allSelectedMode ? ' ' : ' '}selected
                {allSelectedMode && (
                  <span className="text-surface-400 ml-0.5 font-normal">(across all pages)</span>
                )}
              </span>

              <div className="bg-surface-300/30 mx-1 h-4 w-px" />

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => setShowBatchRestoreConfirm(true)}
                  disabled={batchProcessing}
                  className="h-8 rounded-lg text-xs"
                >
                  {batchProcessing ? (
                    <span className="flex items-center gap-1">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                      Restoring...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <RotateCcw className="h-3.5 w-3.5" /> Restore selected
                    </span>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowBatchPermaDeleteConfirm(true)}
                  disabled={batchProcessing}
                  className="border-error/30 text-error hover:bg-error/5 hover:text-error h-8 rounded-lg text-xs"
                  title="Permanently delete selected tasks"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setAllSelectedMode(false);
                    setAllMatchingIds([]);
                  }}
                  className="h-8 rounded-lg text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="normal-bulk"
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className="border-brand-500/20 border bg-brand-500/5 flex flex-wrap items-center gap-2 rounded-2xl p-3"
            >
              <span className="text-surface-600 mr-1 text-xs font-medium">
                <span className="text-brand-500 font-semibold">
                  {allSelectedMode ? totalCount : selectedIds.size}
                </span>
                {allSelectedMode ? ' ' : ' '}selected
                {allSelectedMode && (
                  <span className="text-surface-400 ml-0.5 font-normal">(across all pages)</span>
                )}
              </span>

              <div className="bg-surface-300/30 mx-1 h-4 w-px" />

              {/* Batch Status */}
              <select
                value={batchAction === 'status' ? batchValue : ''}
                onChange={(e) => {
                  setBatchAction('status');
                  setBatchValue(e.target.value);
                }}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 h-8 rounded-lg border px-2 text-xs transition-all focus:outline-none"
              >
                <option value="">Change status...</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>

              {/* Batch Priority */}
              <select
                value={batchAction === 'priority' ? batchValue : ''}
                onChange={(e) => {
                  setBatchAction('priority');
                  setBatchValue(e.target.value);
                }}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 h-8 rounded-lg border px-2 text-xs transition-all focus:outline-none"
              >
                <option value="">Change priority...</option>
                {Object.entries(priorityBadge).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>

              {/* Batch Assign */}
              <select
                value={batchAction === 'assign' ? batchValue : ''}
                onChange={(e) => {
                  setBatchAction('assign');
                  setBatchValue(e.target.value);
                }}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 h-8 rounded-lg border px-2 text-xs transition-all focus:outline-none"
              >
                <option value="">Assign to...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>

              {/* Apply / Cancel */}
              <div className="ml-1 flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={executeBatch}
                  disabled={!batchAction || !batchValue || batchProcessing}
                  className="btn-shine h-8 rounded-lg text-xs"
                >
                  {batchProcessing ? (
                    <span className="flex items-center gap-1">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                      Applying...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <CheckCheck className="h-3.5 w-3.5" /> Apply
                    </span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setAllSelectedMode(false);
                    setAllMatchingIds([]);
                    cancelBatch();
                  }}
                  className="h-8 rounded-lg text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
      </AnimatePresence>

      {/* Content */}
      {loading ? (
        <motion.div
          variants={itemVariants}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="neon-card rounded-2xl p-6">
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4"
                >
                  <div className="shimmer h-4 w-4 rounded" />
                  <div className="shimmer h-4 w-16 rounded-lg" />
                  <div className="shimmer h-4 flex-1 rounded-lg" />
                  <div className="shimmer h-7 w-20 rounded-full" />
                  <div className="shimmer h-7 w-16 rounded-xl" />
                  <div className="shimmer h-4 w-24 rounded-lg" />
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : error ? (
        <motion.div
          variants={itemVariants}
          className="border-error/20 border bg-error/5 flex flex-col items-center rounded-2xl py-12 text-center"
        >
          <AlertCircle className="text-error mb-3 h-10 w-10" />
          <p className="text-error text-sm font-medium">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchTasks} className="mt-3">
            Try again
          </Button>
        </motion.div>
      ) : showTrash ? (          <motion.div
            variants={itemVariants}
            className="neon-card flex flex-col items-center rounded-2xl py-16 text-center"
          >
            <Trash2 className="text-surface-400 mx-auto mb-3 h-10 w-10" />
          <p className="text-surface-500 text-sm font-medium">Trash is empty</p>
          <p className="text-surface-500 mt-1 text-xs">Deleted tasks will appear here</p>
        </motion.div>
      ) : tasks.length === 0 ? (
        search ? (
          <motion.div
            variants={itemVariants}
            className="border-surface-300/20 bg-surface-100/80 rounded-2xl border py-16 text-center"
          >
            <Search className="text-surface-400 mx-auto mb-3 h-10 w-10" />
            <p className="text-surface-500 text-sm font-medium">No tasks match your search</p>
            <p className="text-surface-500 mt-1 text-xs">Try different search terms or filters</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setStatusFilter('');
                setPriorityFilter('');
              }}
              className="mt-3"
            >
              Clear filters
            </Button>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              icon={
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <ClipboardList className="text-surface-300 h-16 w-16" />
                </motion.div>
              }
              title="No tasks yet"
              message="Create your first task to get started with your project."
              action={
                <Link href="/tasks/new">
                  <Button className="btn-shine">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Task
                  </Button>
                </Link>
              }
            />
          </motion.div>
        )
      ) : view === 'board' ? (
        <motion.div variants={itemVariants}>
          <KanbanBoard tasks={tasks} onStatusChange={handleStatusChange} onReorder={handleReorder} />
        </motion.div>
      ) : (
        <>
          <motion.div variants={itemVariants}>
            <Table>
              <THead>
                <TR header>
                  <TH className="w-8 sm:w-10">
                    <Checkbox
                      aria-label="Select all tasks"
                      checked={
                        tasks.length > 0 && (selectedIds.size === tasks.length || allSelectedMode)
                      }
                      onCheckedChange={toggleSelectAll}
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                    />
                  </TH>
                  <TH className="hidden sm:table-cell">ID</TH>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Priority</TH>
                  {showTrash ? (
                    <>
                      <TH className="hidden sm:table-cell">Deleted By</TH>
                      <TH className="hidden sm:table-cell">Deleted At</TH>
                    </>
                  ) : (
                    <>
                      <TH className="hidden sm:table-cell">Assignee</TH>
                      <TH>Due</TH>
                    </>
                  )}
                  <TH className="w-8 sm:w-10" />
                </TR>
              </THead>
              <TBody>
                  {tasks.map((task, idx) => (
                    <motion.tr
                      key={task.id}
                      initial={hadInitialData ? false : { opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: idx * 0.03,
                        type: 'spring',
                        stiffness: 100,
                        damping: 20,
                      }}
                      className={cn(
                        'border-surface-300/10 group cursor-default border-b transition-all duration-150',
                        selectedIds.has(task.id)
                          ? 'bg-brand-500/5 '
                          : 'hover:bg-surface-200/30 hover:-translate-y-px',
                      )}
                    >
                      <TD>
                        <Checkbox
                          aria-label={`Select task: ${task.title}`}
                          checked={selectedIds.has(task.id)}
                          onCheckedChange={() => toggleSelect(task.id)}
                          className="h-3.5 w-3.5 transition-transform duration-150 hover:scale-110 sm:h-4 sm:w-4"
                        />
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="text-surface-500 hover:text-brand-500 font-mono text-[10px] transition-colors duration-200 sm:text-xs"
                        >
                          {task.taskIdDisplay}
                        </Link>
                      </TD>
                      <TD>
                        <Link
                          href={`/tasks/${task.id}`}
                          className="text-surface-900 hover:text-brand-500 inline-block text-xs font-medium transition-all duration-200 group-hover:translate-x-0.5 sm:text-sm"
                        >
                          <span className="line-clamp-1">{task.title}</span>
                          <span className="absolute inset-0" aria-hidden="true" />
                        </Link>
                      </TD>
                      <TD>
                        <Badge variant={statusColors[task.status] ?? 'default'} size="sm" className="px-1.5 py-0 text-[10px] sm:px-2 sm:py-0.5 sm:text-xs">
                          {task.status.replace(/_/g, ' ')}
                        </Badge>
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <span
                          className={cn(
                            'inline-flex items-center text-[11px] font-medium sm:text-xs',
                            priorityBadge[task.priority]?.color ?? 'text-surface-500',
                          )}
                        >
                          {priorityBadge[task.priority]?.label ?? task.priority}
                        </span>
                      </TD>
                      {showTrash ? (
                        <>
                          <TD className="text-surface-500 hidden text-[10px] sm:table-cell sm:text-xs">
                            {task.updatedByName ? (
                              <div className="flex items-center gap-1.5">
                                <div className="from-error/70 to-error ring-surface-200/50 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br text-[8px] font-medium text-white ring-2 sm:h-6 sm:w-6 sm:text-[9px]">
                                  {task.updatedByName.charAt(0).toUpperCase()}
                                </div>
                                <span className="max-w-[80px] truncate sm:max-w-[100px]">{task.updatedByName}</span>
                              </div>
                            ) : (
                              <span className="text-surface-400 italic">Unknown</span>
                            )}
                          </TD>
                          <TD className="text-surface-500 hidden text-[10px] sm:table-cell sm:text-xs">
                            {task.deletedAt ? (
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] sm:text-xs">
                                  {new Date(task.deletedAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                              </span>
                            ) : (
                              <span className="text-surface-400 italic">N/A</span>
                            )}
                          </TD>
                        </>
                      ) : (
                        <>
                          <TD className="text-surface-500 hidden text-[10px] sm:table-cell sm:text-xs">
                            {task.assignedTo ? (
                              <div className="group/assignee flex items-center gap-1.5">
                                <div className="from-brand-400 to-brand-600 ring-surface-200/50 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br text-[8px] font-medium text-white ring-2 transition-transform duration-200 group-hover/assignee:scale-110 sm:h-6 sm:w-6 sm:text-[9px]">
                                  {(task.assignedToName ?? task.assignedTo).charAt(0).toUpperCase()}
                                </div>
                                <span className="max-w-[60px] truncate sm:max-w-[80px]">{task.assignedToName ?? 'Unknown'}</span>
                              </div>
                            ) : (
                              <span className="text-surface-500">—</span>
                            )}
                          </TD>
                          <TD
                            className={cn(
                              'text-[10px] sm:text-xs',
                              task.dueDate &&
                                new Date(task.dueDate) < new Date() &&
                                !['completed', 'closed', 'cancelled'].includes(task.status)
                                ? 'text-error font-medium'
                                : 'text-surface-500',
                            )}
                          >
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : '—'}
                          </TD>
                        </>
                      )}
                      <TD>
                        {showTrash ? (
                          <div className="flex items-center gap-1 sm:gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore(task.id)}
                              disabled={restoringId === task.id}
                              className="h-7 rounded-lg px-1.5 text-[10px] sm:h-8 sm:px-2 sm:text-xs"
                              title="Restore this task"
                            >
                              {restoringId === task.id ? (
                                <span className="flex items-center gap-1">
                                  <span className="border-surface-500 h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                  <span className="hidden sm:inline">Restore</span>
                                </span>
                              )}
                            </Button>
                          </div>
                        ) : (
                          <button
                            aria-label="Task actions"
                            className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 opacity-100 transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          </button>
                        )}
                      </TD>
                    </motion.tr>
                  ))}
              </TBody>
            </Table>
          </motion.div>

          {/* Pagination */}
          {showPagination && (
            <motion.div variants={itemVariants} className="neon-card flex items-center justify-between rounded-xl px-4 py-3">
              <p className="text-surface-500 text-sm">
                Page{' '}
                <span className="text-surface-700 font-medium">
                  {page + 1}
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tasks.length < pageSize}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog
        open={!!deletingTask}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="bg-error/10 flex h-8 w-8 items-center justify-center rounded-full">
                <AlertTriangle className="text-error h-4 w-4" />
              </span>
              Permanently delete task?
            </DialogTitle>
            <DialogDescription className="pt-2">
              This action <strong>cannot be undone</strong>. The task
              {deletingTask && (
                <>
                  {' '}
                  &ldquo;
                  <span className="text-surface-700 font-medium">
                    {deletingTask.title}
                  </span>
                  &rdquo;
                </>
              )}{' '}
              and all its comments, attachments, and history will be permanently removed from the
              database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setDeletingTask(null)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingTask && handlePermanentDelete(deletingTask.id)}
              disabled={deletingId === deletingTask?.id}
              className="rounded-xl"
            >
              {deletingId === deletingTask?.id ? (
                <span className="flex items-center gap-1">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                  Deleting...
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Trash2 className="h-4 w-4" /> Delete permanently
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Restore Confirmation Dialog */}
      <Dialog
        open={showBatchRestoreConfirm}
        onOpenChange={(open) => {
          if (!open) setShowBatchRestoreConfirm(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="bg-brand-500/10 flex h-8 w-8 items-center justify-center rounded-full">
                <RotateCcw className="text-brand-500 h-4 w-4" />
              </span>
              Restore {allSelectedMode ? totalCount : selectedIds.size} task
              {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''}?
            </DialogTitle>
            <DialogDescription className="pt-2">
              This will restore the selected task
              {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''} to their original
              state. They will reappear in the active tasks list and all associated data (comments,
              attachments, history) will be restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => setShowBatchRestoreConfirm(false)}
              disabled={batchProcessing}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowBatchRestoreConfirm(false);
                handleBatchRestore();
              }}
              disabled={batchProcessing}
              className="rounded-xl"
            >
              {batchProcessing ? (
                <span className="flex items-center gap-1">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                  Restoring...
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <RotateCcw className="h-4 w-4" /> Restore{' '}
                  {allSelectedMode ? totalCount : selectedIds.size} task
                  {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''}
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Permanent Delete Confirmation Dialog */}
      <Dialog
        open={showBatchPermaDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setShowBatchPermaDeleteConfirm(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="bg-error/10 flex h-8 w-8 items-center justify-center rounded-full">
                <AlertTriangle className="text-error h-4 w-4" />
              </span>
              Permanently delete {allSelectedMode ? totalCount : selectedIds.size} task
              {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''}?
            </DialogTitle>
            <DialogDescription className="pt-2">
              This action <strong>cannot be undone</strong>. The selected task
              {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''} and all
              associated comments, attachments, and history will be permanently removed from the
              database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => setShowBatchPermaDeleteConfirm(false)}
              disabled={batchProcessing}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchPermanentDelete}
              disabled={batchProcessing}
              className="rounded-xl"
            >
              {batchProcessing ? (
                <span className="flex items-center gap-1">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                  Deleting...
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Trash2 className="h-4 w-4" /> Delete{' '}
                  {allSelectedMode ? totalCount : selectedIds.size} task
                  {(allSelectedMode ? totalCount : selectedIds.size) !== 1 ? 's' : ''} permanently
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
