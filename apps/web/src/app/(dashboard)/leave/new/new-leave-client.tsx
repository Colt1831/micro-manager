'use client';

import { useEffect, useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  Check,
  CalendarDays,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export interface LeaveTypeOption {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
}

interface NewLeaveClientProps {
  /** Server-rendered leave types; null means the server load failed and the client should fetch. */
  initialLeaveTypes: LeaveTypeOption[] | null;
}

export function NewLeaveRequestClient({ initialLeaveTypes }: NewLeaveClientProps) {
  const router = useRouter();
  // When the server provided the options, first paint already has real content.
  const [hadInitialData] = useState(() => initialLeaveTypes !== null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>(initialLeaveTypes ?? []);
  const [loading, setLoading] = useState(initialLeaveTypes === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    // Pre-select the first server-provided type (mirrors the fetch fallback below).
    leaveTypeId: initialLeaveTypes?.[0]?.id ?? '',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    reason: '',
  });

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(async () => {
      try {
        const res = await fetch('/api/leave-types');
        if (res.ok) {
          const data = await res.json();
          setLeaveTypes(data.types ?? []);
          if (data.types?.length > 0) {
            setForm((prev) => ({ ...prev, leaveTypeId: data.types[0].id }));
          }
        }
      } catch {
        // Silently handle
      } finally {
        setLoading(false);
      }
    });
  }, [hadInitialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.leaveTypeId || !form.startDate || !form.endDate || !form.reason.trim()) {
      setError('All fields are required');
      return;
    }

    if (new Date(form.endDate) < new Date(form.startDate)) {
      setError('End date must be on or after start date');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message ?? 'Failed to create request');
      }

      router.push(`/leave/${data.request.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request');
    } finally {
      setSaving(false);
    }
  };

  const daysCount = form.startDate && form.endDate
    ? Math.ceil((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
  } as const;

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } },
  } as const;

  return (
    <motion.div variants={containerVariants} initial={hadInitialData ? false : 'hidden'} animate="visible" className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <Link href="/leave" className="text-surface-500 hover:text-surface-700 mb-3 inline-flex items-center gap-1 text-xs transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Time Off
        </Link>
        <h1 className="text-surface-900 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
            <CalendarDays className="h-4 w-4 text-white" />
          </div>
          Request Time Off
        </h1>
      </motion.div>

      {/* Form */}
      <motion.form
        variants={itemVariants}
        onSubmit={handleSubmit}
        className="neon-card relative space-y-5 overflow-hidden rounded-2xl p-6"
      >
        

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Leave Type */}
            <div>
              <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                Leave Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {leaveTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, leaveTypeId: type.id }))}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all',
                      form.leaveTypeId === type.id
                        ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30'
                        : 'border-surface-300/20 bg-surface-100/50 hover:border-surface-300/40',
                    )}
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${type.color}15`, color: type.color }}
                    >
                      <CalendarDays className="h-4 w-4" />
                    </div>
                    <span className="text-surface-700 text-xs font-medium">{type.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  Start Date
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  End Date
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                />
              </div>
            </div>

            {daysCount > 0 && (
              <p className="text-surface-500 text-xs">
                {daysCount} day{daysCount !== 1 ? 's' : ''} requested
                {form.isHalfDay && ' (half day)'}
              </p>
            )}

            {/* Half day toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="halfDay"
                checked={form.isHalfDay}
                onChange={(e) => setForm((prev) => ({ ...prev, isHalfDay: e.target.checked }))}
                className="border-surface-300/30 bg-surface-100 h-4 w-4 rounded border"
              />
              <label htmlFor="halfDay" className="text-surface-700 text-xs">
                Half day
              </label>
            </div>

            {/* Reason */}
            <div>
              <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                Reason
              </label>
              <textarea
                value={form.reason}
                onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Briefly describe the reason for your time off..."
                rows={3}
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 border-t border-surface-300/10 pt-4">
              <Link href="/leave">
                <Button variant="outline" size="sm" type="button" className="h-8 rounded-lg px-3 text-xs">
                  Cancel
                </Button>
              </Link>
              <Button disabled={saving} size="sm" className="h-8 rounded-lg px-3 text-xs">
                {saving ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Submit Request
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </motion.form>
    </motion.div>
  );
}


