'use client';

import { useEffect, useState, startTransition } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  CalendarDays,
  ArrowLeft,
  Umbrella,
  Thermometer,
  User,
  FileText,
} from 'lucide-react';

interface BalanceItem {
  id: string;
  userId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays: number;
  usedDays: number;
  pendingDays: number;
  notes: string | null;
  leaveType: {
    id: string;
    name: string;
    slug: string;
    color: string;
    icon: string | null;
    description: string | null;
  } | null;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Umbrella, Thermometer, User,
};

function getTypeIcon(name: string | null | undefined) {
  if (!name) return FileText;
  return TYPE_ICONS[name] ?? FileText;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } },
} as const;

export default function LeaveBalancesPage() {
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/leave-balances');
        if (!res.ok) throw new Error('Failed to load balances');
        const data = await res.json();
        setBalances(data.balances ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load balances');
      } finally {
        setLoading(false);
      }
    });
  }, []);

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="mx-auto max-w-2xl space-y-6">
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
          My Leave Balances
        </h1>
        <p className="text-surface-500 mt-0.5 text-sm">Current year balance overview</p>
      </motion.div>

      {/* Balance cards */}
      <motion.div variants={itemVariants} className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-12">
            <AlertCircle className="text-error mb-2 h-8 w-8" />
            <p className="text-error text-sm">{error}</p>
          </div>
        ) : balances.length === 0 ? (
          <div className="neon-card flex flex-col items-center rounded-2xl py-12">
            <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
              <CalendarDays className="text-surface-400 h-7 w-7" />
            </div>
            <h3 className="text-surface-900 text-base font-semibold">No balances allocated yet</h3>
            <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
              Your admin hasn&apos;t allocated leave balances for this year yet.
            </p>
          </div>
        ) : (
          balances.map((balance) => {
            const Icon = getTypeIcon(balance.leaveType?.icon);
            const available = balance.allocatedDays - balance.usedDays - balance.pendingDays;
            const usedPercent = balance.allocatedDays > 0
              ? ((balance.usedDays + balance.pendingDays) / balance.allocatedDays) * 100
              : 0;

            return (
              <div key={balance.id} className="neon-card relative overflow-hidden rounded-2xl p-5">
                <div
                  className="absolute inset-x-0 top-0 h-0.5"
                  style={{ background: `linear-gradient(to right, ${balance.leaveType?.color ?? '#6366f1'}, ${balance.leaveType?.color ?? '#6366f1'}88)` }}
                />
                <div className="flex items-start gap-4">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${balance.leaveType?.color ?? '#6366f1'}15`, color: balance.leaveType?.color ?? '#6366f1' }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-surface-900 text-sm font-semibold">
                      {balance.leaveType?.name ?? 'Leave'}
                    </h3>
                    {balance.leaveType?.description && (
                      <p className="text-surface-500 text-xs">{balance.leaveType.description}</p>
                    )}

                    {/* Usage bar */}
                    <div className="mt-3">
                      <div className="bg-surface-200 h-2 w-full overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(usedPercent, 100)}%`,
                            backgroundColor: balance.leaveType?.color ?? '#6366f1',
                          }}
                        />
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-surface-900 text-lg font-bold">{balance.allocatedDays}</p>
                        <p className="text-surface-500 text-[10px]">Allocated</p>
                      </div>
                      <div>
                        <p className="text-surface-900 text-lg font-bold">{balance.usedDays}</p>
                        <p className="text-surface-500 text-[10px]">Used</p>
                      </div>
                      <div>
                        <p className="text-amber-600 text-lg font-bold">{balance.pendingDays}</p>
                        <p className="text-surface-500 text-[10px]">Pending</p>
                      </div>
                      <div>
                        <p className={available > 0 ? 'text-emerald-600 text-lg font-bold' : 'text-red-500 text-lg font-bold'}>
                          {Math.max(0, available)}
                        </p>
                        <p className="text-surface-500 text-[10px]">Available</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </motion.div>

      {/* Year info */}
      <motion.div variants={itemVariants} className="flex items-center justify-center gap-2 text-[10px] text-surface-400">
        <CalendarDays className="h-3 w-3" />
        <span>Showing balances for {new Date().getFullYear()}</span>
      </motion.div>
    </motion.div>
  );
}
