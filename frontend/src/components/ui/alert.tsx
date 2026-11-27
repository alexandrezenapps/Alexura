import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3 text-xs flex items-start gap-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
  {
    variants: {
      variant: {
        default: 'border-slate-200/10 bg-[#0d121d]/90 text-slate-200',
        info: 'border-sky-400/28 bg-sky-500/10 text-sky-100',
        warning: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
        destructive: 'border-red-400/32 bg-red-500/12 text-red-100',
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
