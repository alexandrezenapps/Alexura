import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:pointer-events-none disabled:opacity-45 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-sky-400 text-zinc-950 hover:bg-sky-300 shadow-xs',
        secondary:
          'bg-zinc-900 text-zinc-100 border border-white/10 hover:bg-zinc-800 hover:border-white/20',
        outline:
          'border border-white/12 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-white',
        ghost: 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
        destructive: 'bg-red-500/90 text-white hover:bg-red-500',
      },
      size: {
        default: 'h-9 px-3.5 py-2',
        sm: 'h-7.5 rounded-md px-2.5 text-[11px]',
        lg: 'h-10 rounded-lg px-5 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
