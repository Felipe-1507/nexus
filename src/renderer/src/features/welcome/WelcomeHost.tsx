import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useLayout } from '@renderer/app/shell/layout-store';
import { Button } from '@renderer/components/ui/Button';
import { usePrivacy } from '@renderer/features/privacy/PrivacyNotice';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { invoke } from '@renderer/lib/ipc';
import { fetchDue, openWelcome, useWelcomeRecap, welcomeKeys } from './queries';
import { useWelcome } from './welcome-store';

/**
 * Primeira abertura do dia: espera o aviso de privacidade e o Workspace, e então abre a tela por cima da galáxia.
 * Fica dentro do `<main>` (a barra lateral e a barra de título continuam à mão).
 */
export function WelcomeHost() {
  const workspace = useActiveWorkspace();
  const privacy = usePrivacy();
  const ready = privacy.data?.acceptedAt != null && workspace != null;
  const due = useQuery({
    queryKey: welcomeKeys.due,
    queryFn: () => fetchDue(false),
    enabled: ready,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !workspace || !due.data?.due) return;
    started.current = true;
    openWelcome(due.data, workspace.id);
    // Marcar na abertura: se o app cair no meio, a tela não volta a cada reinício.
    void invoke('welcome:seen').catch(() => undefined);
  }, [due.data, workspace]);

  const current = useWelcome((s) => s.current);
  return current ? <WelcomeScreen /> : null;
}

/** Atraso (s) entre uma linha e a próxima: o texto vai surgindo aos poucos. */
const STEP = 0.12;
const ITEM_STEP = 0.12;

export function WelcomeScreen() {
  const current = useWelcome((s) => s.current)!;
  const close = useWelcome((s) => s.close);
  const { due, workspaceId, returnView } = current;
  const workspace = useActiveWorkspace();
  const recap = useWelcomeRecap(workspaceId, due.since, due.sinceLabel);
  const dismiss = useCallback(() => {
    close();
    const layout = useLayout.getState();
    if (layout.view === 'galaxy' && returnView !== 'galaxy') layout.setView(returnView);
  }, [close, returnView]);

  useEffect(() => {
    // Captura: o Esc da tela vem antes do da galáxia e dos atalhos globais.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dismiss]);

  const items = recap.data?.items ?? [];
  const nothing = recap.isSuccess && items.length === 0;
  const at = (n: number) => ({ animationDelay: `${n}s` });
  const itemsStart = 0.5;

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="welcome">
      <div className="absolute inset-y-0 left-0 w-full max-w-[36rem] bg-gradient-to-r from-bg via-bg/85 to-transparent" />
      <div className="pointer-events-auto absolute inset-y-0 left-0 flex w-full max-w-[34rem] flex-col overflow-y-auto px-10 py-8">
        {/* my-auto (e não justify-center): centraliza quando cabe e rola desde o topo quando não cabe, sem cortar. */}
        <div className="my-auto">
          <p className="welcome-line text-xs tracking-wide text-muted uppercase" style={at(0)}>
            {workspace?.name ?? ''}
          </p>
          <h1
            className="welcome-line mt-2 text-3xl font-semibold tracking-tight"
            style={at(STEP)}
            data-testid="welcome-greeting"
          >
            {due.greeting}
          </h1>
          <p className="welcome-line mt-1 text-lg text-muted" style={at(STEP * 2)}>
            {due.weekday}
          </p>

          <p className="welcome-line mt-8 text-xs tracking-wide text-muted uppercase" style={at(STEP * 4)}>
            {due.sinceLabel}
          </p>

          {recap.isPending && (
            <p className="welcome-line mt-3 text-sm text-muted" style={at(itemsStart)} data-testid="welcome-loading">
              <span className="thinking-ellipsis">Montando o resumo</span>
            </p>
          )}
          {recap.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Não foi possível montar o resumo: {recap.error?.message}
            </p>
          )}
          {nothing && (
            <p className="welcome-line mt-3 text-sm leading-6" style={at(itemsStart)} data-testid="welcome-empty">
              Nada mudou nos seus sistemas e projetos neste período. Dia tranquilo.
            </p>
          )}
          {items.length > 0 && (
            <ul className="mt-3 space-y-4" data-testid="welcome-items">
              {items.map((item, i) => (
                <li
                  key={item.topic}
                  className="welcome-line"
                  style={at(itemsStart + i * ITEM_STEP)}
                  data-testid="welcome-item"
                >
                  <p className="text-xs font-semibold tracking-wide text-accent uppercase">{item.topic}</p>
                  <p className="mt-0.5 text-sm leading-6">{item.text}</p>
                </li>
              ))}
            </ul>
          )}

          {recap.data && (
            <p
              className="welcome-line mt-8 text-[11px] text-muted"
              style={at(itemsStart + items.length * ITEM_STEP + 0.4)}
              data-testid="welcome-source"
            >
              {recap.refining
                ? 'Resumo montado no seu computador; o Claude está reescrevendo o texto…'
                : recap.data.source === 'claude'
                  ? 'Resumo escrito pelo Claude (modelo pequeno) a partir dos seus commits, notas e conversas.'
                  : 'Resumo montado no seu computador, sem IA.'}
            </p>
          )}

          <div className="mt-6">
            <Button autoFocus variant="primary" onClick={dismiss} data-testid="welcome-continue">
              Continuar
            </Button>
            <span className="ml-3 text-xs text-muted">ou Esc</span>
          </div>
        </div>
      </div>
    </div>
  );
}
