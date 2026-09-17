'use client';

import { useEffect, useState, startTransition, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  CalendarDays,
  ArrowLeft,
  User as UserIcon,
  Clock,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LeaveRequestDetail {
  id: string;
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  attachmentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string | null; avatarUrl: string | null } | null;
  leaveType: { id: string; name: string; slug: string; color: string; icon: string | null } | null;
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'text-amber-600 bg-amber-50 ', dot: 'bg-amber-500', icon: Clock },
  approved: { label: 'Approved', color: 'text-emerald-600 bg-emerald-50 ', dot: 'bg-emerald-500', icon: Check },
  rejected: { label: 'Rejected', color: 'text-red-600 bg-red-50 ', dot: 'bg-red-500', icon: X },
  cancelled: { label: 'Cancelled', color: 'text-surface-500 bg-surface-100 ', dot: 'bg-surface-400', icon: X },
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

interface LeaveDetailClientProps {
  /** Server-rendered request; null means the server load failed/not-found and the client should fetch. */
  initialRequest: LeaveRequestDetail | null;
}

export function LeaveRequestDetailClient({ initialRequest }: LeaveDetailClientProps) {
  const params = useParams();
  const router = useRouter();
  // When the server provided data, first paint already has real content.
  const [hadInitialData] = useState(() => initialRequest !== null);
  const [request, setRequest] = useState<LeaveRequestDetail | null>(initialRequest);
  const [loading, setLoading] = useState(initialRequest === null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const fetchRequest = useCallback(async () => {
    try {
      const res = await fetch(`/api/leave-requests/${params.id}`);
      if (!res.ok) throw new Error('Failed to load request');
      const data = await res.json();
      setRequest(data.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => { fetchRequest(); });
  }, [hadInitialData, fetchRequest]);

  const handleAction = async (action: 'approve' | 'reject') => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/leave-requests/${params.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewNote: reviewNote || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? `Failed to ${action}`);
      }
      fetchRequest();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    setActionLoading('cancel');
    try {
      const res = await fetch(`/api/leave-requests/${params.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to cancel');
      }
      router.push('/leave');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setActionLoading(null);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
  } as const;

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } },
  } as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error && !request) {
    return (
      <div className="flex flex-col items-center py-20">
        <AlertCircle className="text-error mb-2 h-8 w-8" />
        <p className="text-error text-sm">{error}</p>
        <Link href="/leave">
          <Button variant="outline" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs">
            Back to Time Off
          </Button>
        </Link>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center py-20">
        <AlertCircle className="text-surface-400 mb-2 h-8 w-8" />
        <p className="text-surface-500 text-sm">Leave request not found</p>
        <Link href="/leave">
          <Button variant="outline" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs">
            Back to Time Off
          </Button>
        </Link>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[request.status];
  const StatusIcon = statusCfg.icon;
  const isPending = request.status === 'pending';

  return (
    <motion.div variants={containerVariants} initial={hadInitialData ? false : 'hidden'} animate="visible" className="mx-auto max-w-2xl space-y-6">
      {/* Back */}
      <motion.div variants={itemVariants}>
        <Link href="/leave" className="text-surface-500 hover:text-surface-700 mb-3 inline-flex items-center gap-1 text-xs transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Time Off
        </Link>
      </motion.div>

      {/* Status card */}
      <motion.div variants={itemVariants} className="neon-card relative overflow-hidden rounded-2xl p-6">
        

        {/* Status badge */}
        <div className={cn('mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', statusCfg.color)}>
          <StatusIcon className="h-3.5 w-3.5" />
          {statusCfg.label}
        </div>

        {/* Leave type + dates */}
        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${request.leaveType?.color ?? '#6366f1'}15`, color: request.leaveType?.color ?? '#6366f1' }}
          >
            <CalendarDays className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-surface-900 text-lg font-bold">
              {request.leaveType?.name ?? 'Leave'} — {request.daysCount} day{request.daysCount !== 1 ? 's' : ''}
            </h2>
            <p className="text-surface-500 mt-1 text-sm">
              {formatDate(request.startDate)} — {formatDate(request.endDate)}
              {request.isHalfDay && ' (Half day)'}
            </p>
          </div>
        </div>

        {/* Requester info */}
        <div className="border-surface-300/10 mt-4 flex items-center gap-2 border-t pt-3">
          <div className="bg-surface-200 flex h-6 w-6 items-center justify-center rounded-full">
            <UserIcon className="text-surface-500 h-3 w-3" />
          </div>
          <span className="text-surface-700 text-xs font-medium">
            {request.user?.name ?? 'Unknown'}
          </span>
          <span className="text-surface-400 text-[10px]">
            · Submitted {formatDateTime(request.createdAt)}
          </span>
        </div>

        {/* Reason */}
        {request.reason && (
          <div className="border-surface-300/10 mt-3 border-t pt-3">
            <p className="text-surface-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">Reason</p>
            <p className="text-surface-700 text-sm">{request.reason}</p>
          </div>
        )}

        {/* Review info */}
        {request.reviewedBy && (
          <div className="border-surface-300/10 mt-3 border-t pt-3">
            <p className="text-surface-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">
              {request.status === 'approved' ? 'Approved' : 'Rejected'} by
            </p>
            <p className="text-surface-700 text-xs">
              {request.reviewedAt && formatDateTime(request.reviewedAt)}
            </p>
            {request.reviewNote && (
              <p className="text-surface-500 mt-1 text-xs italic">&quot;{request.reviewNote}&quot;</p>
            )}
          </div>
        )}
      </motion.div>

      {/* Review actions (approve/reject) */}
      {isPending && (
        <motion.div variants={itemVariants} className="neon-card relative overflow-hidden rounded-2xl p-5">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-400 to-amber-600" />
          <h3 className="text-surface-900 mb-3 text-sm font-semibold">Review Request</h3>

          {/* Review note */}
          <div className="mb-3">
            <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
              Review Note <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Add a note about your decision..."
              rows={2}
              className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleAction('approve')}
              disabled={actionLoading === 'approve'}
              className="h-8 flex-1 rounded-lg text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {actionLoading === 'approve' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ThumbsUp className="mr-1 h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              onClick={() => handleAction('reject')}
              disabled={actionLoading === 'reject'}
              className="h-8 flex-1 rounded-lg text-xs bg-red-500 hover:bg-red-600 text-white"
            >
              {actionLoading === 'reject' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ThumbsDown className="mr-1 h-3.5 w-3.5" />
              )}
              Reject
            </Button>
          </div>

          {/* Cancel option */}
          <div className="mt-3 border-t border-surface-300/10 pt-3">
            <Button
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
              variant="outline"
              size="sm"
              className="h-7 w-full rounded-lg text-[10px]"
            >
              {actionLoading === 'cancel' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <X className="mr-1 h-3 w-3" />
              )}
              Cancel Request
            </Button>
          </div>

          {error && (
            <div className="bg-error/5 text-error mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
