'use client';

import { useEffect, useState, useCallback, useRef, startTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { motion } from 'framer-motion';
import {
  Loader2,
  Plus,
  AlertCircle,
  Clock,
  CalendarDays,
  Umbrella,
  Thermometer,
  User,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────

export interface LeaveRequestItem {
  id: string;
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  user: { id: string; name: string | null; avatarUrl: string | null } | null;
  leaveType: { id: string; name: string; slug: string; color: string; icon: string | null } | null;
}

// ─── Constants ──────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'text-amber-700 bg-amber-50 ', dot: 'bg-amber-500' },
  approved: { label: 'Approved', color: 'text-emerald-700 bg-emerald-50 ', dot: 'bg-emerald-500' },
  rejected: { label: 'Rejected', color: 'text-red-700 bg-red-50 ', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', color: 'text-surface-500 bg-surface-100 ', dot: 'bg-surface-400' },
} as const;

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Umbrella, Thermometer, User,
};

function getTypeIcon(name: string | null | undefined) {
  if (!name) return FileText;
  return TYPE_ICONS[name] ?? FileText;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ─── Animation variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } },
} as const;

// ─── Main Page ──────────────────────────────────────────────

interface LeaveClientProps {
  /** Server-rendered (unfiltered) requests; null means the server load failed and the client should fetch. */
  initialRequests: LeaveRequestItem[] | null;
}

export function LeaveClient({ initialRequests }: LeaveClientProps) {
  // When the server provided data, first paint already has real content — skip
  // the entrance fade and the initial fetch. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialRequests !== null);
  const [requests, setRequests] = useState<LeaveRequestItem[]>(initialRequests ?? []);
  const [loading, setLoading] = useState(initialRequests === null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (activeFilter) params.set('status', activeFilter);

      const res = await fetch(`/api/leave-requests?${params}`);
      if (!res.ok) throw new Error('Failed to load leave requests');
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  // Skip only the initial fetch when the server seeded the (unfiltered) list;
  // still refetch server-side whenever the status filter changes.
  const skipInitialFetch = useRef(hadInitialData);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    startTransition(() => { fetchRequests(); });
  }, [fetchRequests]);

  const filtered = activeFilter
    ? requests.filter((r) => r.status === activeFilter)
    : requests;

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
  };

  return (
    <motion.div variants={containerVariants} initial={hadInitialData ? false : 'hidden'} animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <PageHeader
          className="mb-0"
          icon={
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <CalendarDays className="h-4 w-4 text-white" />
            </div>
          }
          title="Time Off"
          subtitle="Request and manage time off"
          actions={
            <>
              <Link href="/leave/balances">
                <Button variant="outline" className="h-8 rounded-lg px-3 text-xs">
                  <Clock className="mr-1 h-3.5 w-3.5" />
                  My Balance
                </Button>
              </Link>
              <Link href="/leave/new">
                <Button className="h-8 rounded-lg px-3 text-xs">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  New Request
                </Button>
              </Link>
            </>
          }
        />
      </motion.div>

      {/* Summary cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', count: counts.all, color: 'from-brand-400 to-brand-600' },
          { label: 'Pending', count: counts.pending, color: 'from-amber-400 to-amber-600' },
          { label: 'Approved', count: counts.approved, color: 'from-emerald-400 to-emerald-600' },
          { label: 'Rejected', count: counts.rejected, color: 'from-red-400 to-red-600' },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => setActiveFilter(activeFilter === stat.label.toLowerCase() ? null : stat.label.toLowerCase())}
            className={cn(
              'neon-card relative overflow-hidden rounded-2xl p-4 text-left transition-all duration-200',
              activeFilter === stat.label.toLowerCase() && 'ring-2 ring-brand-500/30',
            )}
          >
            <div className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', stat.color)} />
            <p className="text-surface-500 text-xs font-medium">{stat.label}</p>
            <p className="text-surface-900 mt-1 text-2xl font-bold">{stat.count}</p>
          </button>
        ))}
      </motion.div>

      {/* Request list */}
      <motion.div variants={itemVariants}>
        <div className="neon-card relative overflow-hidden rounded-2xl">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-surface-300 to-surface-400 opacity-40" />
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center py-12">
                <AlertCircle className="text-error mb-2 h-8 w-8" />
                <p className="text-error text-sm">{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-12">
                <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
                  <CalendarDays className="text-surface-400 h-7 w-7" />
                </div>
                <h3 className="text-surface-900 text-base font-semibold">
                  {activeFilter ? `No ${activeFilter} requests` : 'No time-off requests yet'}
                </h3>
                <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
                  {activeFilter ? 'Try a different filter' : 'Create your first time-off request to get started.'}
                </p>
                {!activeFilter && (
                  <Link href="/leave/new" className="mt-5">
                    <Button className="h-8 rounded-xl px-3 text-xs">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Request Time Off
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((req) => {
                  const statusCfg = STATUS_CONFIG[req.status];
                  const TypeIcon = getTypeIcon(req.leaveType?.icon);
                  return (
                    <Link
                      key={req.id}
                      href={`/leave/${req.id}`}
                      className="border-surface-300/20 bg-surface-50/50 hover:border-surface-300/40 group flex items-start gap-3 rounded-xl border p-3 transition-all hover:shadow-sm"
                    >
                      {/* Type icon */}
                      <div
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${req.leaveType?.color ?? '#6366f1'}15`, color: req.leaveType?.color ?? '#6366f1' }}
                      >
                        <TypeIcon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-surface-900 truncate text-sm font-medium">
                            {req.leaveType?.name ?? 'Leave'}
                          </span>
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', statusCfg.color)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusCfg.dot)} />
                            {statusCfg.label}
                          </span>
                        </div>
                        <p className="text-surface-500 mt-0.5 text-xs">
                          {formatDate(req.startDate)} — {formatDate(req.endDate)}
                          {req.isHalfDay && ' (Half day)'}
                          <span className="text-surface-400 ml-1.5">· {req.daysCount} day{req.daysCount !== 1 ? 's' : ''}</span>
                        </p>
                        {req.reason && (
                          <p className="text-surface-400 mt-1 line-clamp-1 text-[11px]">{req.reason}</p>
                        )}
                      </div>

                      {/* Arrow */}
                      <ChevronRightIcon className="text-surface-400 mt-1 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
