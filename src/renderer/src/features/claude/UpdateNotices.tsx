import { Download, Rocket, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/Button';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useAppUpdateStatus, useInstallAppUpdate } from '@renderer/features/app-update/queries';
import { useClaudeUpdate, useClaudeUpdater, useMarkModelsSeen, useNewModels } from './queries';

const DISMISSED_KEY = 'nexus.dismissedClaudeUpdate';
const DISMISSED_APP_KEY = 'nexus.dismissedAppUpdate';

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
  const app = useAppUpdateStatus().data;
  const installApp = useInstallAppUpdate();
  const [dismissedApp, setDismissedApp] = useState(() => localStorage.getItem(DISMISSED_APP_KEY));
  const showApp = Boolean(app?.available) && !app?.error && dismissedApp !== app?.latest;

  const showUpdate = Boolean(update?.available) && dismissed !== update?.latest;
  if (!showUpdate && !showApp && news.length === 0) return null;

  return (
    <div data-testid="update-notices" className="flex flex-col border-b border-border bg-surface text-xs">
      {showApp && app && (
        <div role="status" data-testid="app-update-notice" className="flex items-center gap-2 px-4 py-1.5">
          <Rocket size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {installApp.isPending || installApp.isSuccess
              ? 'Instalando… o Nexus vai fechar e reabrir sozinho.'
              : `Nexus ${app.latest} disponível (você tem ${app.current}).`}
          </span>
          {!installApp.isPending && !installApp.isSuccess && (
            <Button variant="primary" className="px-2.5 py-1 text-xs" onClick={() => installApp.mutate()}>
              Atualizar agora
            </Button>
          )}
          <IconButton
            label="Dispensar aviso de atualização do Nexus"
            className="size-6"
            onClick={() => {
              localStorage.setItem(DISMISSED_APP_KEY, app.latest ?? '');
              setDismissedApp(app.latest);
            }}
          >
            <X size={12} />
          </IconButton>
        </div>
      )}
      {installApp.isError && (
        <p role="alert" className="px-4 py-1 text-danger">
          {installApp.error.message}
        </p>
      )}
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
