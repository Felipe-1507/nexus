import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';
import { chatKeys } from './queries';

interface SyncButtonProps {
  conversationId: string;
  /** Há uma resposta em andamento (ou mensagens na fila): a sincronização espera. */
  disabled: boolean;
}

/**
 * Traz para esta tela o que a sessão do Claude Code ganhou fora do Nexus (VS Code, terminal). O Claude já lembra de
 * tudo; isto só atualiza o histórico visível, e a sessão não é alterada.
 */
export function SyncButton({ conversationId, disabled }: SyncButtonProps) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const sync = useMutation({
    mutationFn: () => invoke('conversations:sync', { conversationId }),
  });

  async function run(): Promise<void> {
    setResult(null);
    try {
      const { added } = await sync.mutateAsync();
      setResult({
        text: added === 0 ? 'Já está em dia.' : `${added} ${added === 1 ? 'mensagem trazida' : 'mensagens trazidas'}.`,
        error: false,
      });
      if (added > 0) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['context'] });
      }
    } catch (err) {
      setResult({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        disabled={disabled || sync.isPending}
        onClick={() => void run()}
        title="Traz para esta tela as mensagens que a sessão ganhou fora do Nexus (VS Code, terminal). O Claude já lembra de tudo; a sessão não é alterada."
        data-testid="sync-button"
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors',
          'hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <RefreshCw size={12} className={sync.isPending ? 'animate-spin' : undefined} aria-hidden />
        Sincronizar com o Claude Code
      </button>
      {result && (
        <span
          role={result.error ? 'alert' : 'status'}
          data-testid="sync-result"
          className={cn('min-w-0 truncate text-[11px]', result.error ? 'text-danger' : 'text-muted')}
        >
          {result.text}
        </span>
      )}
    </div>
  );
}
