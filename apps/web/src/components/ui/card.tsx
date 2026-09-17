import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Opt in to hover feedback. Only set this when the whole card is a link or
   * button — a static panel that lifts under the cursor promises an action it
   * does not have, and the app reads as a demo when every surface reacts.
   */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Opaque surface: the translucent + backdrop-blur treatment muddied text
        // over dense tables and cost a paint on every scroll.
        'border-surface-700/15 bg-surface-200 text-surface-900 rounded-xl border shadow-card',
        interactive &&
          'hover:border-surface-700/30 hover:bg-surface-300/60 cursor-pointer transition-colors duration-150',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 px-6 py-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'text-surface-900 text-base font-semibold leading-tight tracking-tight',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pb-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
