import { ArrowDown, ArrowUp, GitFork, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatIdle, formatTokens, type ContextOverviewRow } from '@shared/context';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useChat } from '@renderer/features/chat/chat-store';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { useContextOverview, useNow } from './queries';
import { describeContext, formatDateTime, LEVEL_STYLES, levelLabel } from './view';

type SortKey = 'context' | 'activity';

/** Hora da última atividade conhecida: a da última chamada medida ou, sem medição, a da última mensagem. */
function activityAt(row: ContextOverviewRow): number {
  return Date.parse(row.snapshot?.lastCallAt ?? row.updatedAt) || 0;
}

/**
 * Painel geral de sessões: todas as conversas do Workspace, de todos os projetos, com o tamanho do contexto de cada
 * uma. Os números vêm do que já foi medido nas respostas (ou lido do histórico do Claude Code); abrir o painel não faz
 * nenhuma chamada ao Claude.
 */
export function SessionsOverview() {
  const workspace = useActiveWorkspace();
  const overview = useContextOverview(workspace?.id);
  const now = useNow();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'context', dir: 'desc' });
  const select = useChat((s) => s.select);
  const setScope = useChat((s) => s.setScope);
  const setView = useLayout((s) => s.setView);

  const rows = useMemo(() => {
    const list = [...(overview.data?.rows ?? [])];
    const factor = sort.dir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      if (sort.key === 'context') {
        const x = a.snapshot?.contextTokens ?? null;
        const y = b.snapshot?.contextTokens ?? null;
        // Sem medição vai sempre para o fim, qualquer que seja a direção.
        if (x === null && y === null) return activityAt(b) - activityAt(a);
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * factor || activityAt(b) - activityAt(a);
      }
      return (activityAt(a) - activityAt(b)) * factor;
    });
    return list;
  }, [overview.data, sort]);

  if (!workspace) {
    return <p className="p-8 text-sm text-muted">Crie um Workspace para ver as sessões.</p>;
  }

  function open(row: ContextOverviewRow) {
    setScope(workspace!.id, row.projectId);
    select(workspace!.id, row.conversationId);
    setView('chat');
  }

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  }

  const thresholds = overview.data?.thresholds;
  const described = rows.map((row) => ({
    row,
    view: thresholds ? describeContext(row.snapshot, thresholds, now) : null,
  }));
  const attention = described.filter(
    (d) => d.view && (d.view.level === 'attention' || d.view.level === 'high' || d.view.level === 'critical'),
  ).length;

  return (
    <div className="h-full overflow-y-auto" data-testid="sessions-overview">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Sessões</h1>
        <p className="mt-1 text-sm leading-6 text-muted">
          O tamanho do contexto de cada conversa de {workspace.name}. Contexto grande faz cada passo do Claude reler
          mais histórico; ele não é o consumo da cota do plano. Os dados vêm das respostas já feitas: este painel não
          chama o Claude.
        </p>

        {overview.isError && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {overview.error.message}
          </p>
        )}
        {overview.isSuccess && rows.length === 0 && (
          <p className="mt-6 text-sm text-muted">Nenhuma conversa neste Workspace ainda.</p>
        )}

        {rows.length > 0 && (
          <>
            <p className="mt-4 text-xs text-muted" data-testid="sessions-summary">
              {rows.length} {rows.length === 1 ? 'conversa' : 'conversas'}
              {attention > 0 && ` · ${attention} com contexto a observar`}
            </p>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-surface">
              <table className="w-full min-w-[44rem] text-left text-xs">
                <thead className="border-b border-border text-[11px] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Projeto</th>
                    <th className="px-4 py-2.5 font-medium">Conversa</th>
                    <SortHeader
                      label="Contexto"
                      active={sort.key === 'context'}
                      dir={sort.dir}
                      onClick={() => toggle('context')}
                    />
                    <th className="px-4 py-2.5 font-medium">Ocupação</th>
                    <SortHeader
                      label="Última atividade"
                      active={sort.key === 'activity'}
                      dir={sort.dir}
                      onClick={() => toggle('activity')}
                    />
                    <th className="px-4 py-2.5 font-medium">Cache</th>
                    <th className="px-4 py-2.5 font-medium">Atenção</th>
                  </tr>
                </thead>
                <tbody>
                  {described.map(({ row, view }) => (
                    <SessionRow key={row.conversationId} row={row} view={view} now={now} onOpen={() => open(row)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2.5 font-medium" aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 uppercase hover:text-text focus-visible:outline-2 focus-visible:outline-accent',
          active && 'text-text',
        )}
      >
        {label}
        {active && (dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );
}

function SessionRow({
  row,
  view,
  now,
  onOpen,
}: {
  row: ContextOverviewRow;
  view: ReturnType<typeof describeContext> | null;
  now: number;
  onOpen: () => void;
}) {
  const snap = row.snapshot;
  const style = LEVEL_STYLES[view?.level ?? 'unknown'];
  const at = activityAt(row);
  const cacheText =
    !view || view.cache.state === 'unknown'
      ? '—'
      : view.cache.state === 'maybe-expired'
        ? 'Pode ter expirado'
        : 'Ativo';
  const flags: string[] = [];
  if (view?.level && view.level !== 'normal') flags.push(levelLabel(view.level));
  if (view?.warnCache) flags.push('Conversa grande parada: o cache pode ter expirado');

  return (
    <tr
      data-testid="session-row"
      data-conversation-id={row.conversationId}
      data-level={view?.level ?? 'unknown'}
      className="border-b border-border last:border-0 hover:bg-surface-2/60"
    >
      <td className="px-4 py-2.5 text-muted">{row.projectName ?? 'Geral'}</td>
      <td className="max-w-[16rem] px-4 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex max-w-full items-center gap-2 text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {row.running && (
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label="Respondendo" />
          )}
          <span className="truncate">{row.title}</span>
          {row.forkedFrom && (
            <span title="Continuação de outra conversa" className="shrink-0 text-muted">
              <GitFork size={11} aria-label="Continuação" />
            </span>
          )}
        </button>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap" data-testid="session-context">
        {snap?.contextTokens == null ? (
          <span className="text-muted" title="Sem medição disponível">
            indisponível
          </span>
        ) : (
          <span title={`${snap.contextTokens.toLocaleString('pt-BR')} tokens`}>{formatTokens(snap.contextTokens)}</span>
        )}
      </td>
      <td className="px-4 py-2.5" data-testid="session-percent">
        {view?.percent == null ? (
          <span className="text-muted" title="A janela do modelo não é conhecida">
            —
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className={cn('h-full rounded-full', style.dot)}
                style={{ width: `${Math.min(100, Math.max(2, view.percent))}%` }}
              />
            </div>
            <span className={style.text}>{Math.round(view.percent)}%</span>
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-muted" title={formatDateTime(new Date(at).toISOString())}>
        {formatIdle(Math.max(0, now - at))}
      </td>
      <td
        className={cn('px-4 py-2.5 whitespace-nowrap', view?.warnCache ? 'text-amber-500' : 'text-muted')}
        data-testid="session-cache"
      >
        {cacheText}
      </td>
      <td className="px-4 py-2.5" data-testid="session-attention">
        {flags.length > 0 && (
          <span
            title={flags.join(' · ')}
            className={cn('inline-flex', view?.level === 'critical' ? 'text-danger' : 'text-amber-500')}
          >
            <TriangleAlert size={14} aria-label={flags.join(' · ')} />
          </span>
        )}
      </td>
    </tr>
  );
}
