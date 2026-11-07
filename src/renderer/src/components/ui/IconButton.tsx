import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

/** Botão só com ícone. `label` vira o nome acessível e a dica. */
export function IconButton({ label, active, className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'no-drag grid size-8 place-items-center rounded-lg text-muted transition-colors',
        'hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-surface-2 text-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
