import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status/label pill.
 *
 * Tinted-fill pills (a 10% colour wash behind saturated text) on every row made
 * tables read as a sea of coloured blobs — colour carried no priority because
 * everything had it. Default is now a quiet outline; the dot carries the hue, so
 * a scanning eye gets state from position and shape first and colour second.
 *
 * Use `solid` only where a single badge must genuinely interrupt (a hard
 * failure, an unread count) — not for ordinary row state.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-100',
  {
    variants: {
      variant: {
        default: 'border-surface-700/20 bg-surface-300/40 text-surface-700',
        primary: 'border-brand-500/25 bg-brand-500/8 text-brand-300',
        success: 'border-success/25 bg-success/8 text-success',
        warning: 'border-warning/25 bg-warning/8 text-warning',
        danger: 'border-error/25 bg-error/8 text-error',
        info: 'border-info/25 bg-info/8 text-info',
      },
      size: {
        default: 'px-2 py-0.5 text-xs',
        sm: 'px-1.5 py-0 text-[11px]',
        lg: 'px-2.5 py-1 text-sm',
      },
      solid: {
        true: 'border-transparent',
        false: '',
      },
    },
    compoundVariants: [
      { solid: true, variant: 'primary', class: 'bg-brand-500 text-white' },
      { solid: true, variant: 'success', class: 'bg-success text-surface-50' },
      { solid: true, variant: 'warning', class: 'bg-warning text-surface-50' },
      { solid: true, variant: 'danger', class: 'bg-error text-white' },
      { solid: true, variant: 'info', class: 'bg-info text-surface-50' },
      { solid: true, variant: 'default', class: 'bg-surface-400 text-surface-900' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
      solid: false,
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show the leading state dot. On by default; off for count/numeric pills. */
  dot?: boolean;
}

function Badge({ className, variant, size, solid, dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, solid }), className)} {...props}>
      {dot && !solid ? (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            variant === 'primary' && 'bg-brand-400',
            variant === 'success' && 'bg-success',
            variant === 'warning' && 'bg-warning',
            variant === 'danger' && 'bg-error',
            variant === 'info' && 'bg-info',
            (!variant || variant === 'default') && 'bg-surface-500',
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
