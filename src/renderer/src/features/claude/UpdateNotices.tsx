import { Download, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/Button';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useClaudeUpdate, useClaudeUpdater, useMarkModelsSeen, useNewModels } from './queries';

const DISMISSED_KEY = 'nexus.dismissedClaudeUpdate';

/**
 * Faixa discreta no topo da área principal: versão nova do Claude Code (com botão Atualizar) e modelo novo na
 * conta. Cada aviso some quando o usuário dispensa e só volta para uma versão ou modelo diferente.
 */
export function UpdateNotices() {
  const update = useClaudeUpdate().data;
  const news = useNewModels().data ?? [];
  const markSeen = useMarkModelsSeen();
  const updater = useClaudeUpdater();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY));

  const showUpdate = Boolean(update?.available) && dismissed !== update?.latest;
  if (!showUpdate && news.length === 0) return null;

  return (
    <div data-testid="update-notices" className="flex flex-col border-b border-border bg-surface text-xs">
      {showUpdate && update && (
        <div role="status" data-testid="claude-update-notice" className="flex items-center gap-2 px-4 py-1.5">
          <Download size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {updater.updating
              ? 'Atualizando… quando terminar a janela do console, volte para cá.'
              : `Claude Code ${update.latest} disponível (você tem ${update.current}). Atualizar traz modelos e correções novos.`}
          </span>
          {!updater.updating && (
            <Button
              variant="primary"
              className="px-2.5 py-1 text-xs"
              onClick={() => updater.start.mutate()}
              disabled={updater.start.isPending}
            >
              Atualizar
            </Button>
          )}
          <IconButton
            label="Dispensar aviso de atualização"
            className="size-6"
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, update.latest ?? '');
              setDismissed(update.latest);
              updater.cancel();
            }}
          >
            <X size={12} />
          </IconButton>
        </div>
      )}
      {updater.start.isError && (
        <p role="alert" className="px-4 py-1 text-danger">
          {updater.start.error.message}
        </p>
      )}
      {news.length > 0 && (
        <div role="status" data-testid="new-model-notice" className="flex items-center gap-2 px-4 py-1.5">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {news.length === 1 ? 'Novo modelo disponível: ' : 'Novos modelos disponíveis: '}
            <strong className="font-semibold">{news.map((m) => m.displayName).join(', ')}</strong>. Escolha no seletor
            de modelo da conversa.
          </span>
          <IconButton
            label="Entendi, dispensar aviso de modelo novo"
            className="size-6"
            onClick={() => markSeen.mutate()}
          >
            <X size={12} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
