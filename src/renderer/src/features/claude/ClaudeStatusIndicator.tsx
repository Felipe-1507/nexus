import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useClaudeStatus } from './queries';

/** Indicador compacto na barra lateral. Clicar leva aos detalhes nas Configurações. */
export function ClaudeStatusIndicator() {
  const { data, isPending, isError } = useClaudeStatus();
  const setView = useLayout((s) => s.setView);

  const state = isPending ? 'checking' : isError || !data?.ready ? 'error' : data.warnings.length ? 'warning' : 'ok';
  const label = {
    checking: 'Verificando Claude Code…',
    ok: 'Claude Code conectado',
    warning: 'Claude Code com avisos',
    error: 'Claude não conectado',
  }[state];

  return (
    <button
      type="button"
      onClick={() => setView('settings')}
      data-testid="claude-indicator"
      data-state={state}
      title="Ver detalhes do Claude Code"
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          state === 'checking' && 'animate-pulse bg-muted',
          state === 'ok' && 'bg-ok',
          state === 'warning' && 'bg-amber-500',
          state === 'error' && 'bg-danger',
        )}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
