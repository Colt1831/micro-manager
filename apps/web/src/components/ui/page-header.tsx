import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — the canonical page title block for every dashboard page.
 *
 * One uniform Sora display title (+ optional breadcrumb, icon, subtitle) with a
 * right-aligned actions slot, replacing the ~25 hand-rolled `<h1>` variants across
 * the app. Colors are base-only semantic classes (correct in both themes; no
 * stale `` overrides).
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned action buttons (e.g. a primary "New …" button + filters). */
  actions?: React.ReactNode;
  /** Optional breadcrumb rendered above the title. */
  breadcrumb?: React.ReactNode;
  /** Optional leading icon rendered inline with the title. */
  icon?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, breadcrumb, icon, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {breadcrumb && (
          <div className="text-surface-500 mb-1 flex items-center gap-1.5 text-xs font-medium">
            {breadcrumb}
          </div>
        )}
        <h1 className="text-surface-950 flex items-center gap-2.5 text-[22px] font-semibold tracking-tight sm:text-2xl">
          {icon}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="text-surface-500 max-w-2xl text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
