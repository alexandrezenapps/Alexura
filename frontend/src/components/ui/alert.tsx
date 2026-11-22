import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-xs flex items-start gap-2.5',
  {
    variants: {
      variant: {
        default: 'border-white/10 bg-zinc-900/70 text-zinc-200',
        info: 'border-sky-500/25 bg-sky-500/8 text-sky-200',
        warning: 'border-amber-500/25 bg-amber-500/8 text-amber-200',
        destructive: 'border-red-500/30 bg-red-500/10 text-red-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

export { Alert };
