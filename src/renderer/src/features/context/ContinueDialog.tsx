import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { Conversation } from '@shared/chat';
import { contextLevel, contextPercent, formatTokens } from '@shared/context';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { useContextState, useContinuationPreview, useContinueConversation, useNow } from './queries';
import { cacheSentence, describeContext, formatUsd } from './view';

interface ContinueDialogProps {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  /** A conversa nova (ou a continuação que já existia) está pronta. */
  onOpenConversation: (conversation: Conversation) => void;
}

/**
 * Confirmação de "Continuar em nova conversa". Mostra, antes de qualquer coisa, o tamanho do contexto, o que a
 * compactação vai ler, a chance de o cache ter de ser regravado e o custo de referência. Nada é executado até o clique.
 */
export function ContinueDialog({ open, conversationId, onClose, onOpenConversation }: ContinueDialogProps) {
  const preview = useContinuationPreview(conversationId, open);
  const state = useContextState(open ? conversationId : null);
  const mutation = useContinueConversation();
  const now = useNow();
  const [structured, setStructured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = mutation.isPending;

  const snapshot = preview.data?.snapshot ?? null;
  const thresholds = state.data?.thresholds;
  const view = thresholds ? describeContext(snapshot, thresholds, now) : null;
  const percent = snapshot ? contextPercent(snapshot) : null;
  const level = thresholds ? contextLevel(percent, thresholds) : null;
  const existing = preview.data?.existing ?? null;
  const running = preview.data?.running ?? false;

  async function confirm(): Promise<void> {
    setError(null);
    try {
      const result = await mutation.mutateAsync({ conversationId, structuredSummary: structured });
      onOpenConversation(result.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const contextText =
    snapshot?.contextTokens == null
      ? 'indisponível'
      : `${formatTokens(snapshot.contextTokens)} tokens${percent === null ? '' : ` · ${Math.round(percent)}% da janela`}${level === 'critical' || level === 'high' ? ' (elevado)' : ''}`;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Continuar em nova conversa"
      description="O Nexus copia a sessão do Claude Code e compacta só a cópia, com o /compact oficial. A conversa original não é aberta nem alterada."
    >
      <div className="space-y-4" data-testid="continue-dialog">
        {preview.isError && (
          <p role="alert" className="text-xs text-danger">
            {preview.error.message}
          </p>
        )}

        <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-xs leading-5" data-testid="continue-facts">
          <dt className="text-muted">Contexto atual</dt>
          <dd data-testid="continue-context">{contextText}</dd>

          <dt className="text-muted">A processar (estimativa)</dt>
          <dd data-testid="continue-process">
            {snapshot?.contextTokens == null
              ? 'indisponível'
              : `a compactação lê o contexto inteiro uma vez: cerca de ${formatTokens(snapshot.contextTokens)} tokens`}
          </dd>

          <dt className="text-muted">Cache</dt>
          <dd data-testid="continue-cache">
            {view ? cacheSentence(view.cache, snapshot?.cacheRebuilt ?? null) : '…'}
            {view?.cache.state === 'maybe-expired' && (
              <> Se tiver expirado, todo o contexto será gravado de novo, o que custa mais que ler do cache.</>
            )}
          </dd>

          <dt className="text-muted">Custo de referência</dt>
          <dd data-testid="continue-cost">
            {snapshot?.costUsd == null
              ? 'indisponível'
              : `o último turno desta conversa custou ${formatUsd(snapshot.costUsd)} em preço de lista`}
          </dd>
        </dl>

        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-4 text-muted">
          O custo de referência é calculado em preço de lista e não representa diretamente a porcentagem da cota do
          plano Pro. O consumo da cota depende de como o plano pesa cada tipo de token.
        </p>

        <p className="text-[11px] leading-4 text-amber-500" data-testid="continue-undo-note">
          O histórico de &quot;Desfazer&quot; das alterações em arquivos não é copiado: na conversa nova não será
          possível desfazer o que foi alterado na original.
        </p>

        <label className="flex items-start gap-2 text-xs leading-5">
          <input
            type="checkbox"
            checked={structured}
            disabled={pending}
            onChange={(e) => setStructured(e.target.checked)}
            className="mt-1 accent-[var(--accent)]"
            data-testid="continue-structured"
          />
          <span>
            Gerar resumo estruturado (objetivo, alterações, arquivos, decisões, problemas e próximos passos) e mostrá-lo
            na conversa nova.
          </span>
        </label>

        {existing && (
          <p className="text-xs leading-5" data-testid="continue-existing">
            Já existe uma continuação feita depois da última atividade desta conversa:{' '}
            <span className="font-medium">{existing.title}</span>.
          </p>
        )}
        {running && (
          <p className="text-xs text-amber-500">Aguarde a resposta atual terminar para continuar em nova conversa.</p>
        )}
        {pending && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted" data-testid="continue-progress">
            <LoaderCircle size={14} className="animate-spin" /> Copiando e compactando… isso pode levar alguns minutos.
            Não feche o Nexus.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger" data-testid="continue-error">
            {error} Nada foi criado e a conversa original continua intacta.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          {existing ? (
            <Button variant="primary" onClick={() => onOpenConversation(existing)} data-testid="continue-open-existing">
              Abrir a continuação
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={pending || running || preview.isPending || preview.isError}
              onClick={() => void confirm()}
              data-testid="continue-confirm"
            >
              Continuar em nova conversa
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
