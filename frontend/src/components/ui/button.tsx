import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-semibold transition-[background,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/75 focus-visible:ring-offset-1 focus-visible:ring-offset-[#06080e] active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-45 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'border border-sky-400/50 bg-gradient-to-br from-[#0b5be0] via-[#148bff] to-[#38bdf8] text-white shadow-[0_6px_18px_-4px_rgba(14,139,255,0.42),inset_0_1px_0_rgba(255,255,255,0.28)] hover:from-[#0f68f5] hover:via-[#2698ff] hover:to-[#58cbf9] hover:border-sky-300/75 hover:shadow-[0_8px_22px_-4px_rgba(14,139,255,0.56),inset_0_1px_0_rgba(255,255,255,0.36)]',
        secondary:
          'border border-slate-200/12 bg-gradient-to-b from-[#1a2030] to-[#121723] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.065),0_2px_6px_rgba(0,0,0,0.35)] hover:border-sky-400/45 hover:from-[#1f293e] hover:to-[#162033] hover:text-white',
        outline:
          'border border-slate-200/13 bg-[#0a0e16]/85 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-sky-400/45 hover:bg-sky-500/12 hover:text-white',
        ghost:
          'border border-transparent text-slate-300 hover:border-slate-200/10 hover:bg-slate-800/60 hover:text-white',
        champagne:
          'border border-[#deb96c]/40 bg-gradient-to-r from-[#deb96c]/16 via-[#deb96c]/12 to-indigo-400/16 text-[#f3deb0] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_3px_12px_-4px_rgba(222,185,108,0.22)] hover:border-[#f3deb0]/65 hover:from-[#deb96c]/26 hover:to-indigo-400/26 hover:text-white',
        emerald:
          'border border-emerald-400/40 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_3px_12px_-4px_rgba(16,185,129,0.22)] hover:border-emerald-300/65 hover:from-emerald-500/30 hover:to-teal-500/30 hover:text-white',
        destructive:
          'border border-red-400/45 bg-gradient-to-b from-red-500/90 to-red-600/95 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.20)] hover:from-red-500 hover:to-red-600',
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
