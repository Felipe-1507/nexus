import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ClaudeStatus } from '@shared/claude';
import { Button } from '@renderer/components/ui/Button';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useClaudeSetup, useClaudeStatus, useClaudeWatch, useRefreshClaudeStatus } from './queries';

type StepState = 'done' | 'current' | 'upcoming';

/**
 * Passo a passo no lugar do chat enquanto o Claude não está pronto: instalar o Claude Code e entrar com a conta.
 * Os dois botões abrem janelas fora do app; o Nexus percebe sozinho quando cada passo termina.
 */
export function ConnectClaude({ className }: { className?: string }) {
  const { data } = useClaudeStatus();
  if (!data || data.ready) return null;
  return <Steps status={data} className={className} />;
}

function Steps({ status, className }: { status: ClaudeStatus; className?: string }) {
  const { install, login } = useClaudeSetup();
  const refresh = useRefreshClaudeStatus();
  const watching = useClaudeWatch((s) => s.until > Date.now());
  const setView = useLayout((s) => s.setView);
  const { cli, auth } = status;
  const installed = cli.state === 'found';
  const error = install.error ?? login.error ?? refresh.error;

  return (
    <section
      aria-label="Conectar o Claude"
      data-testid="connect-claude"
      className={cn('rounded-2xl border border-border bg-surface p-5', className)}
    >
      <h2 className="text-sm font-semibold">Conecte o Claude para conversar</h2>
      <p className="mt-1 text-xs leading-5 text-muted">
        Notas e código já funcionam sem ele. Para conversar, é preciso uma assinatura do Claude que inclua o Claude
        Code.
      </p>

      <ol className="mt-4 space-y-3">
        <Step
          n={1}
          state={installed ? 'done' : 'current'}
          title={installed ? `Claude Code ${cli.version} instalado` : 'Instale o Claude Code'}
          description={
            cli.state === 'error'
              ? `${cli.message} Instalar de novo costuma resolver.`
              : installed
                ? undefined
                : 'O instalador oficial da Anthropic abre numa janela do PowerShell.'
          }
          action={
            !installed && (
              <Button variant="primary" disabled={install.isPending} onClick={() => install.mutate()}>
                {cli.state === 'error' ? 'Instalar de novo' : 'Instalar'}
              </Button>
            )
          }
        />
        <Step
          n={2}
          state={!installed ? 'upcoming' : 'current'}
          title="Entre com a sua conta"
          description={
            auth.state === 'unknown' && installed
              ? auth.message
              : 'O login abre no navegador. O Nexus nunca vê a sua senha.'
          }
          action={
            <Button
              variant={installed ? 'primary' : 'secondary'}
              disabled={!installed || login.isPending}
              onClick={() => login.mutate()}
            >
              Entrar com a minha conta
            </Button>
          }
        />
      </ol>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error.message}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
        {watching ? (
          <span className="flex items-center gap-1.5" aria-live="polite">
            <Loader2 size={13} className="animate-spin" />
            Aguardando… o Nexus percebe sozinho quando terminar.
          </span>
        ) : (
          <button
            type="button"
            className="underline-offset-2 hover:text-text hover:underline"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Já fiz isso, verificar agora
          </button>
        )}
        <button
          type="button"
          className="underline-offset-2 hover:text-text hover:underline"
          onClick={() => setView('settings')}
        >
          Detalhes
        </button>
      </div>
    </section>
  );
}

function Step({
  n,
  state,
  title,
  description,
  action,
}: {
  n: number;
  state: StepState;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3" data-state={state}>
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
          state === 'done' && 'bg-ok/15 text-ok',
          state === 'current' && 'bg-accent-soft text-accent ring-1 ring-accent/30',
          state === 'upcoming' && 'bg-surface-2 text-muted',
        )}
      >
        {state === 'done' ? <Check size={14} /> : n}
      </span>
      <div className={cn('min-w-0 flex-1', state === 'upcoming' && 'opacity-60')}>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}
