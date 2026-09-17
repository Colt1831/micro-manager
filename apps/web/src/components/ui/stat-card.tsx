import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * StatCard — the canonical KPI / metric tile: a glass card with a big Sora
 * numeral, an accent icon, an optional delta chip (with trend arrow), a
 * sublabel, and an optional mini sparkline slot.
 *
 * Colors are accent-driven: pass `color` as any CSS color (hex or a
 * `var(--color-…)` token); it tints the icon square + the top accent bar via
 * `color-mix`. A superset of the ad-hoc TrendCard pattern in the analytics
 * page, so those can adopt it directly (same icon/label/value/sublabel/trend
 * props). Base-only semantic classes — correct in both themes.
 */
export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Accent color (hex or `var(--color-…)`); default electric violet. */
  color?: string;
  /** Delta text, e.g. "+12%". Rendered as a trend-colored chip. */
  delta?: React.ReactNode;
  /** Direction — colors the delta chip and picks the arrow. */
  trend?: 'up' | 'down' | 'neutral';
  sublabel?: React.ReactNode;
  /** Optional sparkline / mini-chart rendered along the bottom. */
  chart?: React.ReactNode;
}

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, icon, color = 'var(--color-brand-500)', delta, trend, sublabel, chart, className, ...props }, ref) => {
    const tint = (pct: string) => `color-mix(in srgb, ${color} ${pct}, transparent)`;
    const trendChip =
      trend === 'up'
        ? 'bg-success/12 text-success'
        : trend === 'down'
          ? 'bg-error/12 text-error'
          : 'bg-surface-300/40 text-surface-500';

    return (
      <div
        ref={ref}
        className={cn(
          // Opaque, calm chrome. A KPI strip is read at a glance: the numeral is
          // the content, so the container stays quiet and does not react to the
          // cursor (these are not clickable).
          'group relative overflow-hidden rounded-xl border border-surface-700/15 bg-surface-200 p-4',
          'shadow-card',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-surface-600 text-[11px] font-medium uppercase tracking-wide">{label}</p>
          {icon && (
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: tint('10%'), color }}
            >
              {icon}
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-end gap-2">
          <span className="stat-value text-surface-950 text-[32px] font-semibold leading-none tracking-tight">
            {value}
          </span>
          {(delta || trend === 'up' || trend === 'down') && (
            <span
              className={cn(
                'mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                trendChip,
              )}
            >
              {trend === 'up' ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : trend === 'down' ? (
                <ArrowDownRight className="h-3 w-3" />
              ) : null}
              {delta}
            </span>
          )}
        </div>

        {sublabel && <p className="text-surface-500 mt-1 text-[11px]">{sublabel}</p>}
        {chart && <div className="mt-2 -mb-1">{chart}</div>}
      </div>
    );
  },
);
StatCard.displayName = 'StatCard';
