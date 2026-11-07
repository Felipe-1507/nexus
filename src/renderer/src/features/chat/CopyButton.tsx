import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';

/** Copia o texto para a área de transferência e confirma por um instante com "Copiado". */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await invoke('clipboard:write', { text });
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1_800);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-text',
        'focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
    >
      {state === 'copied' ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      <span aria-live="polite">
        {state === 'copied' ? 'Copiado' : state === 'failed' ? 'Não foi possível copiar' : 'Copiar'}
      </span>
    </button>
  );
}
