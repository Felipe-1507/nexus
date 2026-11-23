import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HEAVY_SERVER_TOKENS, type DeclaredServer, type ServerStatus } from '@shared/extensions';
import { Button } from '@renderer/components/ui/Button';
import { useProjects } from '@renderer/features/projects/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { invoke } from '@renderer/lib/ipc';

const SCOPE_LABEL: Record<DeclaredServer['scope'], string> = {
  user: 'Usuário',
  project: 'Projeto',
  local: 'Local do projeto',
  plugin: 'Plugin',
};

const STATUS: Record<ServerStatus['status'], { label: string; tone: string }> = {
  connected: { label: 'Conectado', tone: 'text-ok' },
  failed: { label: 'Falhou', tone: 'text-danger' },
  'needs-auth': { label: 'Precisa entrar', tone: 'text-amber-500' },
  pending: { label: 'Conectando', tone: 'text-muted' },
  disabled: { label: 'Desligado', tone: 'text-muted' },
};

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n));

/** Configurações → Extensões do Claude: servidores MCP e plugins configurados, e o peso de cada um no contexto. */
export function ExtensionsSection() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const projects = useProjects(workspaceId);
  const [projectId, setProjectId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['extensions', 'list', workspaceId],
    queryFn: () => invoke('extensions:list', { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const probe = useMutation({
    mutationFn: () => invoke('extensions:probe', { workspaceId: workspaceId!, projectId }),
  });
  const data = list.data;
  const result = probe.data;
  const status = new Map(result?.servers.map((s) => [s.name, s]));

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="extensions-section">
      <h2 className="text-sm font-semibold">Extensões do Claude (MCP e plugins)</h2>
      <p className="mt-1 text-xs text-muted">
        O que o Claude Code carrega ao abrir uma conversa. Cada servidor MCP coloca as descrições das suas ferramentas
        no contexto inicial, e isso pesa em toda mensagem. A lista vem dos arquivos de configuração (nenhum segredo é
        lido); &quot;Verificar&quot; abre o Claude Code sem enviar mensagem para ver quem conecta e quanto pesa.
      </p>

      {list.isError && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {list.error.message}
        </p>
      )}
      {data?.problems.map((p) => (
        <p key={p} role="alert" className="mt-3 text-xs text-amber-500">
          {p}
        </p>
      ))}

      {data && (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Servidores MCP</h3>
            {data.servers.length === 0 ? (
              <p className="mt-1 text-xs text-muted" data-testid="extensions-no-servers">
                Nenhum servidor MCP configurado nos arquivos. Conectores do claude.ai (se houver) aparecem só depois de
                &quot;Verificar&quot;.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border" data-testid="extensions-servers">
                {data.servers.map((s) => {
                  const live = status.get(s.name);
                  return (
                    <li key={`${s.scope}:${s.origin}:${s.name}`} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="truncate text-xs text-muted" title={s.target}>
                          {SCOPE_LABEL[s.scope]}
                          {s.origin ? ` · ${s.origin}` : ''} · {s.transport} · {s.target}
                        </p>
                      </div>
                      {live && <LiveBadge live={live} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Plugins</h3>
            {data.plugins.length === 0 ? (
              <p className="mt-1 text-xs text-muted" data-testid="extensions-no-plugins">
                Nenhum plugin nos arquivos lidos. Plugins e conectores ligados à sua conta aparecem em
                &quot;Verificar&quot;.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border" data-testid="extensions-plugins">
                {data.plugins.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.id}</p>
                      <p className="truncate text-xs text-muted">
                        {p.version ? `versão ${p.version}` : 'sem versão'}
                        {p.servers.length > 0 ? ` · MCP: ${p.servers.join(', ')}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs ${p.enabled ? 'text-ok' : 'text-muted'}`}>
                      {p.enabled ? 'Ligado' : 'Desligado'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          Verificar em
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text"
            data-testid="extensions-scope"
          >
            <option value="">Configurações do usuário</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                Projeto {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() => probe.mutate()}
          disabled={probe.isPending || !workspaceId}
          data-testid="extensions-probe"
        >
          {probe.isPending ? 'Verificando…' : 'Verificar'}
        </Button>
        {probe.isPending && (
          <span className="text-xs text-muted">Pode levar alguns segundos (os servidores sobem).</span>
        )}
      </div>

      {probe.isError && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {probe.error.message}
        </p>
      )}
      {result && (
        <div className="mt-4 rounded-xl border border-border bg-bg p-3 text-xs" data-testid="extensions-result">
          <p>
            <span className="font-medium">{result.scope}:</span> {result.servers.length}{' '}
            {result.servers.length === 1 ? 'servidor' : 'servidores'}; ferramentas MCP ocupam{' '}
            <strong>{tokens(result.mcpTokens)} tokens</strong> do contexto inicial (de {tokens(result.baseTokens)}, numa
            janela de {tokens(result.maxTokens)}).
          </p>
          {result.servers.length === 0 && (
            <p className="mt-1 text-muted">O Claude Code não encontrou servidores MCP neste escopo.</p>
          )}
          <OtherServers servers={result.servers.filter((s) => !data?.servers.some((d) => d.name === s.name))} />
        </div>
      )}
    </section>
  );
}

/** Servidores que o Claude Code carregou e que não estão nos arquivos lidos (plugins e conectores da conta). */
function OtherServers({ servers }: { servers: ServerStatus[] }) {
  if (servers.length === 0) return null;
  const ok = servers.filter((s) => s.status === 'connected').length;
  return (
    <details className="mt-2" data-testid="extensions-others">
      <summary className="cursor-pointer text-muted">
        {servers.length} {servers.length === 1 ? 'outro servidor' : 'outros servidores'} (plugins e conectores da
        conta): {ok} conectado{ok === 1 ? '' : 's'}
      </summary>
      <ul className="mt-1 space-y-1">
        {servers.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {s.name} <span className="text-muted">({s.source ?? 'origem desconhecida'})</span>
            </span>
            <LiveBadge live={s} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function LiveBadge({ live }: { live: ServerStatus }) {
  const st = STATUS[live.status];
  const heavy = live.tokens >= HEAVY_SERVER_TOKENS;
  return (
    <div className="shrink-0 text-right text-xs" title={live.error ?? undefined} data-testid="extensions-live">
      <p className={st.tone}>{st.label}</p>
      {live.status === 'connected' && (
        <p className={heavy ? 'font-medium text-amber-500' : 'text-muted'}>
          {live.tools} {live.tools === 1 ? 'ferramenta' : 'ferramentas'} · {tokens(live.tokens)} tokens
          {heavy ? ' (pesado)' : ''}
        </p>
      )}
      {live.error && <p className="max-w-56 truncate text-danger">{live.error}</p>}
    </div>
  );
}
