import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'border border-border bg-surface hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
