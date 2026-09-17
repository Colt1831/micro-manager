import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Canonical data-table primitives. Consolidates the hand-rolled `<table>` markup
 * (tasks list, corrections, settings) into a shared set matching the app's styling:
 * a `neon-card` glass wrapper with horizontal scroll, uppercase hairline headers,
 * and hover/selected row states. Compose freely; pass `className` on `TH`/`TD` for
 * the responsive `hidden sm:table-cell` column pattern.
 */

export function Table({ className, children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="border-surface-700/15 bg-surface-200 shadow-card overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className={cn('w-full text-sm', className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Header row: gets the header background + strong border (no hover). */
  header?: boolean;
  /** Body row highlighted as selected. */
  selected?: boolean;
}

export function TR({ className, header, selected, ...props }: TRProps) {
  return (
    <tr
      className={cn(
        header
          ? 'border-surface-500/25 bg-surface-300/50 border-b'
          : cn(
              // A 10%-alpha divider was effectively invisible, so rows ran
              // together and the eye had nothing to track across a wide table.
              'border-surface-700/12 border-b transition-colors duration-100',
              selected ? 'bg-brand-500/10' : 'hover:bg-surface-300/40',
            ),
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'text-surface-600 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide sm:px-4 sm:py-2.5',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  // Denser rows: an operator scanning 20+ tasks sees more per screen, and the
  // page stops feeling padded out to fill space.
  return <td className={cn('px-2 py-2 sm:px-4 sm:py-2.5', className)} {...props} />;
}
