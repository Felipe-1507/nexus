import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ClaudeStatus } from '@shared/claude';
import { Button } from '@renderer/components/ui/Button';
import { useClaudeSetup, useClaudeStatus, useRefreshClaudeStatus } from './queries';

const planLabels: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
  free: 'Free',
};
const sourceLabels = {
  override: 'caminho configurado',
  path: 'PATH do sistema',
  native: 'instalação nativa',
  npm: 'npm global',
};

/** Seção "Claude Code" das Configurações: o que foi encontrado e o que fazer quando algo falta. */
export function ClaudeStatusPanel() {
  const status = useClaudeStatus();
  const refresh = useRefreshClaudeStatus();
  const checking = status.isPending || refresh.isPending;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="claude-status">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Claude Code</h2>
          <p className="mt-1 text-xs text-muted">
            O Nexus conversa por meio do Claude Code instalado neste computador e usa a conta conectada nele.
          </p>
        </div>
        <Button onClick={() => refresh.mutate()} disabled={checking} className="shrink-0 whitespace-nowrap">
          <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />
          Verificar novamente
        </Button>
      </div>

      <div className="mt-4" aria-live="polite">
        {checking && !status.data && <p className="text-sm text-muted">Verificando…</p>}
        {(status.isError || refresh.isError) && (
          <p role="alert" className="text-sm text-danger">
            {(refresh.error ?? status.error)?.message}
          </p>
        )}
        {status.data && <Details status={status.data} />}
      </div>
    </section>
  );
}

function Details({ status }: { status: ClaudeStatus }) {
  const { cli, auth } = status;
  return (
    <div className="space-y-4">
      <Row
        label="Instalação"
        tone={cli.state === 'found' ? 'ok' : 'error'}
        value={
          cli.state === 'found'
            ? `Claude Code ${cli.version}`
            : cli.state === 'not_found'
              ? 'Não encontrado'
              : 'Encontrado, mas não executou'
        }
      >
        {cli.state === 'found' && (
          <p className="font-mono text-xs break-all text-muted">
            {cli.path} · {sourceLabels[cli.source]}
          </p>
        )}
        {cli.state === 'not_found' && (
          <Guide action={<SetupButton kind="install" />}>
            O botão abre o instalador oficial numa janela do PowerShell (
            <Cmd>irm https://claude.ai/install.ps1 | iex</Cmd>). A instalação pelo npm (
            <Cmd>npm install -g @anthropic-ai/claude-code</Cmd>) também funciona. O Nexus percebe sozinho quando
            terminar.
          </Guide>
        )}
        {cli.state === 'error' && (
          <Guide>
            {cli.message} Rode <Cmd>claude --version</Cmd> num terminal para ver o erro completo.
            <span className="mt-1 block font-mono break-all">{cli.path}</span>
          </Guide>
        )}
      </Row>

      {cli.state === 'found' && (
        <Row
          label="Conta"
          tone={auth.state === 'logged_in' ? 'ok' : 'error'}
          value={
            auth.state === 'logged_in'
              ? (auth.email ?? 'Conectada')
              : auth.state === 'logged_out'
                ? 'Nenhuma conta conectada'
                : 'Não foi possível verificar'
          }
        >
          {auth.state === 'logged_in' && (
            <p className="text-xs text-muted">
              {[
                auth.organization,
                auth.plan && `plano ${planLabels[auth.plan] ?? auth.plan}`,
                auth.method && `login via ${auth.method}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {auth.state === 'logged_out' && (
            <Guide action={<SetupButton kind="login" />}>
              O botão abre o login do Claude Code (<Cmd>claude auth login</Cmd>), que continua no navegador. O Nexus
              nunca vê nem guarda a sua senha ou token.
            </Guide>
          )}
          {auth.state === 'unknown' && <Guide>{auth.message}</Guide>}
        </Row>
      )}

      {status.warnings.map((w) => (
        <div key={w} className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          {w}
        </div>
      ))}

      <p className="text-[11px] text-muted">
        Verificado às {new Date(status.checkedAt).toLocaleTimeString('pt-BR')}. Esta verificação não consome tokens.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'error';
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_6rem_1fr] gap-2">
      {tone === 'ok' ? (
        <CheckCircle2 size={16} className="mt-0.5 text-ok" aria-hidden />
      ) : (
        <XCircle size={16} className="mt-0.5 text-danger" aria-hidden />
      )}
      <span className="text-sm text-muted">{label}</span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm">{value}</p>
        {children}
      </div>
    </div>
  );
}

function Guide({ children, action }: { children: ReactNode; action?: ReactNode }) {
  if (!action) return <p className="text-xs leading-5 text-muted">{children}</p>;
  return (
    <div className="space-y-2">
      {action}
      <p className="text-xs leading-5 text-muted">{children}</p>
    </div>
  );
}

/** Mesmos botões do passo a passo do chat. */
function SetupButton({ kind }: { kind: 'install' | 'login' }) {
  const setup = useClaudeSetup();
  const mutation = setup[kind];
  return (
    <div>
      <Button variant="primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        {kind === 'install' ? 'Instalar o Claude Code' : 'Entrar com a minha conta'}
      </Button>
      {mutation.isError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}

function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text select-all">{children}</code>
  );
}
