'use client';

import { useEffect, useState, useCallback, useRef, startTransition } from 'react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useScrollShadow } from '@/lib/hooks/use-scroll-shadow';
import {
  Check,
  X,
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  Inbox,
  Loader2,
  MessageSquare,
  UserCheck,
  ArrowRightLeft,
  AlertTriangle,
  Clock,
  Flag,
  AtSign,
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  isDismissed: boolean;
  readAt: string | null;
  createdAt: string;
}

interface NotifResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

type ViewFilter = 'all' | 'unread';
type GroupKey = 'today' | 'yesterday' | 'week' | 'older';

// ─── Constants ──────────────────────────────────────────────

const NOTIF_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  task_assigned: { label: 'Task Assigned', color: 'text-blue-500 bg-blue-500/10' },
  task_comment: { label: 'New Comment', color: 'text-green-500 bg-green-500/10' },
  task_status_changed: { label: 'Status Changed', color: 'text-amber-500 bg-amber-500/10' },
  task_mention: { label: 'Mention', color: 'text-purple-500 bg-purple-500/10' },
  task_due_soon: { label: 'Due Soon', color: 'text-orange-500 bg-orange-500/10' },
  task_overdue: { label: 'Overdue', color: 'text-red-500 bg-red-500/10' },
  task_escalated: { label: 'Escalated', color: 'text-rose-500 bg-rose-500/10' },
  task_completed: { label: 'Completed', color: 'text-emerald-500 bg-emerald-500/10' },
  task_reopened: { label: 'Reopened', color: 'text-cyan-500 bg-cyan-500/10' },
};

const NOTIF_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  task_assigned: UserCheck,
  task_comment: MessageSquare,
  task_status_changed: ArrowRightLeft,
  task_mention: AtSign,
  task_due_soon: Clock,
  task_overdue: AlertTriangle,
  task_escalated: Flag,
  task_completed: Check,
  task_reopened: ArrowRightLeft,
};

function getNotifIcon(type: string) {
  const Icon = NOTIF_TYPE_ICONS[type] ?? Bell;
  return Icon;
}

function getNotifColor(type: string): string {
  return NOTIF_TYPE_CONFIG[type]?.color ?? 'text-surface-500 bg-surface-500/10';
}

function getNotifLabel(type: string): string {
  return NOTIF_TYPE_CONFIG[type]?.label ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRelativeDate(dateStr: string, nowMs: number): string {
  const date = new Date(dateStr);
  const diffMs = nowMs - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}function groupNotifications(notifs: Notification[], nowMs: number): Array<{ key: GroupKey; label: string; items: Notification[] }> {
  const groups: Record<GroupKey, Notification[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  for (const n of notifs) {
    const d = new Date(n.createdAt);
    if (d >= today) groups.today.push(n);
    else if (d >= yesterday) groups.yesterday.push(n);
    else if (d >= weekAgo) groups.week.push(n);
    else groups.older.push(n);
  }

  const labels: Record<GroupKey, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'This Week',
    older: 'Older',
  };

  return (Object.entries(groups) as [GroupKey, Notification[]][])
    .filter(([_, items]) => items.length > 0)
    .map(([key, items]) => ({ key, label: labels[key], items }));
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
//  NOTIFICATION CENTER PAGE
// ═══════════════════════════════════════════════════════════════

export interface NotificationsClientProps {
  /** Server-seeded first page; null means the server load failed and the client fetches on mount. */
  initialNotifications: Notification[] | null;
  initialTotal: number;
  initialUnread: number;
  /** Server render time (ms) — used for the initial now-relative render so SSR and hydration match. */
  serverNow: number;
}

export function NotificationsClient({
  initialNotifications,
  initialTotal,
  initialUnread,
  serverNow,
}: NotificationsClientProps) {
  const [hadInitialData] = useState(() => initialNotifications !== null);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications ?? []);
  const [total, setTotal] = useState(initialTotal);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [loading, setLoading] = useState(initialNotifications === null);
  // Relative times + today/yesterday grouping depend on "now". Start from the
  // server's render time so the first client render matches the SSR HTML exactly
  // (no hydration mismatch), then advance to the real clock after mount.
  const [now, setNow] = useState(serverNow);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Scroll-shadow for sticky group headers ────────────────
  const { shadowSpring, shadowParallaxSpring } = useScrollShadow();

  // ── Fetch notifications ─────────────────────────────────

  const fetchNotifs = useCallback(
    async (append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: append ? '0' : String(offset),
        });
        if (filter === 'unread') params.set('unread', 'true');

        const res = await fetch(`/api/notifications?${params}`);
        if (!res.ok) throw new Error('Failed to load notifications');
        const data: NotifResponse = await res.json();

        if (append) {
          setNotifications((prev) => [...prev, ...data.notifications]);
        } else {
          setNotifications(data.notifications);
        }
        setTotal(data.total);
        setUnreadCount(data.unreadCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notifications');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [limit, offset, filter],
  );

  // Skip the initial fetch when the server seeded the first page; filter/offset
  // changes still refetch (fetchNotifs identity changes).
  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    startTransition(() => fetchNotifs());
  }, [fetchNotifs]);

  // Advance the relative-time reference to the real clock after hydration.
  useEffect(() => {
    startTransition(() => setNow(Date.now()));
  }, []);

  // ── Mark as read ────────────────────────────────────────

  const markAsRead = useCallback(async (id: string) => {
    setWorking(id);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read', notificationId: id }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // Ignore
    } finally {
      setWorking(null);
    }
  }, []);

  // ── Mark all as read ────────────────────────────────────

  const markAllAsRead = useCallback(async () => {
    setWorking('all');
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
        setUnreadCount(0);
        setSelectedIds(new Set());
      }
    } catch {
      // Ignore
    } finally {
      setWorking(null);
    }
  }, []);

  // ── Bulk mark as read ───────────────────────────────────

  const bulkMarkRead = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setWorking('bulk');
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            selectedIds.has(n.id) ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - selectedIds.size));
        setSelectedIds(new Set());
        setBulkMode(false);
      }
    } catch {
      // Ignore
    } finally {
      setWorking(null);
    }
  }, [selectedIds]);

  // ── Dismiss ─────────────────────────────────────────────

  const dismiss = useCallback(async (id: string) => {
    setWorking(id);
    try {
      const res = await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setTotal((prev) => prev - 1);
      }
    } catch {
      // Ignore
    } finally {
      setWorking(null);
    }
  }, []);

  // ── Bulk dismiss ────────────────────────────────────────

  const bulkDismiss = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setWorking('bulk_dismiss');
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/notifications?id=${id}`, { method: 'DELETE' }),
        ),
      );
      setNotifications((prev) => prev.filter((n) => !selectedIds.has(n.id)));
      setTotal((prev) => prev - selectedIds.size);
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch {
      // Ignore
    } finally {
      setWorking(null);
    }
  }, [selectedIds]);

  // ── Selection helpers ───────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(notifications.map((n) => n.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // ── More / Back ─────────────────────────────────────────

  const hasMore = notifications.length < total;

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    setOffset((prev) => prev + limit);
  };

  const hasPrevious = offset > 0;

  const goBack = () => {
    setOffset((prev) => Math.max(0, prev - limit));
  };

  // ── Notification item ───────────────────────────────────

  const renderNotif = (n: Notification) => {
    const Icon = getNotifIcon(n.type);
    const isSelected = selectedIds.has(n.id);
    const isWorking = working === n.id;

    return (
      <motion.div
        key={n.id}
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className={cn(
          'group relative flex items-start gap-3 border-b border-surface-300/10 px-4 py-3.5 transition-all duration-200',
          !n.isRead && 'bg-brand-500/[0.02]',
          isSelected && 'bg-brand-500/5',
          !n.isRead && 'hover:bg-brand-500/[0.04]',
          n.isRead && 'hover:bg-surface-200/30 ',
        )}
      >
        {/* Bulk mode checkbox */}
        {bulkMode && (
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelect(n.id)}
              className="border-surface-400 text-brand-500 focus:ring-brand-500 h-4 w-4 rounded transition-all"
            />
          </div>
        )}

        {/* Type Icon */}
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all',
            getNotifColor(n.type),
            !n.isRead && 'ring-1 ring-brand-500/20',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={cn(
                  'truncate text-sm leading-snug',
                  !n.isRead
                    ? 'text-surface-900 font-semibold'
                    : 'text-surface-600 font-normal',
                )}
              >
                {n.title}
                {!n.isRead && (
                  <span className="bg-brand-500 ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" />
                )}
              </p>
              {n.message && (
                <p className="text-surface-500 mt-0.5 line-clamp-2 text-xs leading-relaxed">
                  {n.message}
                </p>
              )}
            </div>

            {/* Actions (visible on hover) */}
            {!bulkMode && (
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {!n.isRead && (
                  <button
                    onClick={() => markAsRead(n.id)}
                    disabled={!!isWorking}
                    className="text-surface-400 hover:text-brand-500 hover:bg-brand-500/10 rounded-lg p-1.5 transition-all"
                    title="Mark as read"
                  >
                    {isWorking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => dismiss(n.id)}
                  disabled={!!isWorking}
                  className="text-surface-400 hover:text-error hover:bg-error/10 rounded-lg p-1.5 transition-all"
                  title="Dismiss"
                >
                  {isWorking && working === n.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="mt-1 flex items-center gap-2 text-[10px]">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium',
                getNotifColor(n.type),
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {getNotifLabel(n.type)}
            </span>
            <span className="text-surface-400">{formatRelativeDate(n.createdAt, now)}</span>
            {n.link && (
              <>
                <span className="text-surface-300 ">·</span>
                <a
                  href={n.link}
                  className="text-brand-500 hover:text-brand-400 hover:underline"
                >
                  View
                </a>
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="mx-auto max-w-3xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-surface-900 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <BellRing className="h-4 w-4 text-white" />
            </div>
            Notifications
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            {total > 0
              ? `${total} notification${total !== 1 ? 's' : ''} · ${unreadCount} unread`
              : 'Stay up to date with your workspace'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && !bulkMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={markAllAsRead}
              disabled={working === 'all'}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {working === 'all' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="mr-1 h-3.5 w-3.5" />
              )}
              Mark All Read
            </Button>
          )}
          <Button
            variant={bulkMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setBulkMode(!bulkMode);
              setSelectedIds(new Set());
            }}
            className="h-8 rounded-lg px-3 text-xs"
          >
            {bulkMode ? (
              <>
                <X className="mr-1 h-3.5 w-3.5" />
                Done
              </>
            ) : (
              <>
                <CheckCheck className="mr-1 h-3.5 w-3.5" />
                Select
              </>
            )}
          </Button>
        </div>
      </motion.div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {bulkMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-brand-500/10 border-brand-500/20 flex items-center gap-2 rounded-xl border px-4 py-2.5">
              <span className="text-surface-900 text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAll}
                  className="h-7 rounded-lg px-2 text-[10px]"
                  disabled={selectedIds.size === notifications.length}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  className="h-7 rounded-lg px-2 text-[10px]"
                  disabled={selectedIds.size === 0}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={bulkMarkRead}
                  disabled={working === 'bulk' || selectedIds.size === 0}
                  className="h-7 rounded-lg px-2 text-[10px]"
                >
                  {working === 'bulk' ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  Mark Read
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={bulkDismiss}
                  disabled={working === 'bulk_dismiss' || selectedIds.size === 0}
                  className="h-7 rounded-lg px-2 text-[10px] bg-red-500 hover:bg-red-600"
                >
                  {working === 'bulk_dismiss' ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-3 w-3" />
                  )}
                  Dismiss
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter tabs */}
      <motion.div variants={itemVariants}>
        <div
          className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={filter === 'all'}
            onClick={() => { setFilter('all'); setOffset(0); setSelectedIds(new Set()); }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              filter === 'all'
                ? 'bg-surface-50 text-surface-900 shadow-sm'
                : 'text-surface-500 hover:text-surface-700 ',
            )}
          >
            <Bell className="-ml-0.5 mr-1.5 inline h-3.5 w-3.5" />
            All
            {total > 0 && (
              <span className="bg-surface-300/30 ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]">
                {total}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={filter === 'unread'}
            onClick={() => { setFilter('unread'); setOffset(0); setSelectedIds(new Set()); }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              filter === 'unread'
                ? 'bg-surface-50 text-surface-900 shadow-sm'
                : 'text-surface-500 hover:text-surface-700 ',
            )}
          >
            <BellOff className="-ml-0.5 mr-1.5 inline h-3.5 w-3.5" />
            Unread
            {unreadCount > 0 && (
              <span className="bg-brand-500/20 text-brand-500 ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </motion.div>

      {/* Notifications list */}
      <motion.div variants={itemVariants}>
        <div className="neon-card relative overflow-hidden rounded-2xl">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-600 opacity-40" />

          {loading ? (
            <div className="space-y-0 p-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  <div className="shimmer h-8 w-8 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="shimmer h-4 w-3/4 rounded-lg" />
                    <div className="shimmer h-3 w-1/2 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-16">
              <div className="bg-error/10 mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                <BellOff className="text-error h-6 w-6" />
              </div>
              <p className="text-error text-sm font-medium">Failed to load notifications</p>
              <p className="text-surface-500 mt-1 text-xs">{error}</p>
              <Button variant="outline" size="sm" className="mt-4 h-8 rounded-lg px-3 text-xs" onClick={() => fetchNotifs()}>
                Retry
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
                <Inbox className="text-surface-400 h-7 w-7" />
              </div>
              <h3 className="text-surface-900 text-base font-semibold">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </h3>
              <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
                {filter === 'unread'
                  ? 'You\'re all caught up! Switch to All to see your full history.'
                  : 'Notifications about your tasks and activity will appear here.'}
              </p>
              {filter === 'unread' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 h-8 rounded-lg px-3 text-xs"
                  onClick={() => setFilter('all')}
                >
                  <Bell className="mr-1 h-3.5 w-3.5" />
                  View All
                </Button>
              )}
            </div>
          ) : (
            <div ref={listRef}>
              {groupNotifications(notifications, now).map((group) => (
                <div key={group.key}>
                  {/* Group header with scroll-shadow */}
                  <motion.div className="sticky top-0 z-10 relative border-b border-surface-300/10 bg-surface-100/90 px-4 py-2 backdrop-blur-sm">
                    {/* Light-mode shadow */}
                    <motion.div
                      className="pointer-events-none absolute top-full left-0 right-0 h-2 "
                      style={{
                        opacity: shadowSpring,
                        y: shadowParallaxSpring,
                        background: 'linear-gradient(to bottom, rgba(0,0,0,0.06), transparent)',
                      }}
                    />
                    {/* Dark-mode shadow */}
                    <motion.div
                      className="pointer-events-none absolute top-full left-0 right-0 h-2 hidden "
                      style={{
                        opacity: shadowSpring,
                        y: shadowParallaxSpring,
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)',
                      }}
                    />
                    <span className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                      {group.label}
                    </span>
                    <span className="text-surface-400 ml-2 text-[10px]">
                      {group.items.length} notification{group.items.length !== 1 ? 's' : ''}
                    </span>
                  </motion.div>

                  {/* Notifications in group */}
                  <AnimatePresence mode="popLayout">
                    {group.items.map((n) => renderNotif(n))}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {!loading && notifications.length > 0 && (
            <div className="border-surface-300/10 flex items-center justify-between border-t px-4 py-3">
              <span className="text-surface-500 text-xs">
                Showing {Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={goBack}
                  disabled={!hasPrevious}
                  className={cn(
                    'rounded-lg p-1.5 text-xs transition-all',
                    hasPrevious
                      ? 'text-surface-600 hover:bg-surface-200/50 hover:text-surface-900'
                      : 'text-surface-300 cursor-not-allowed',
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={loadMore}
                  disabled={!hasMore || loadingMore}
                  className={cn(
                    'rounded-lg p-1.5 text-xs transition-all',
                    hasMore
                      ? 'text-surface-600 hover:bg-surface-200/50 hover:text-surface-900'
                      : 'text-surface-300 cursor-not-allowed',
                  )}
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Keyboard hint */}
          {notifications.length > 0 && !bulkMode && (
            <div className="flex items-center justify-center gap-2 border-t border-surface-300/10 px-4 py-2 text-[10px] text-surface-400">
              <Sparkles className="h-3 w-3" />
              <span>Hover to mark as read or dismiss</span>
              {unreadCount > 0 && (
                <>
                  <span className="text-surface-300 ">·</span>
                  <button
                    onClick={markAllAsRead}
                    disabled={working === 'all'}
                    className="text-brand-500 hover:text-brand-400 hover:underline"
                  >
                    Mark all as read
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
