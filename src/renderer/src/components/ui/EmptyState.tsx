import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}

/** Estado vazio honesto: diz o que vai aparecer ali, sem dados de exemplo. */
export function EmptyState({ icon, title, description, className, children }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', className)}>
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-surface-2 text-muted">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-64 text-xs leading-5 text-muted">{description}</p>}
      {children}
    </div>
  );
}
