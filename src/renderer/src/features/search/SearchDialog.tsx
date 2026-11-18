import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SEARCH_MIN_LENGTH, type SearchHit } from '@shared/search';
import type { Workspace } from '@shared/workspace';
import { useLayout } from '@renderer/app/shell/layout-store';
import { Dialog } from '@renderer/components/ui/Dialog';
import { useChat } from '@renderer/features/chat/chat-store';
import { useProjects } from '@renderer/features/projects/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatFullTime, formatMessageTime } from '@renderer/lib/format-time';
import { useSearch } from './search-store';

const DEBOUNCE_MS = 250;
const NO_HITS: SearchHit[] = [];

/** Busca nas conversas: janela aberta pelo botão da barra de título ou por Ctrl+Shift+F. */
export function SearchHost() {
  const open = useSearch((s) => s.open);
  const hide = useSearch((s) => s.hide);
  const workspace = useActiveWorkspace();
  return (
    <Dialog
      open={open && Boolean(workspace)}
      onClose={hide}
      size="wide"
      title="Buscar nas conversas"
      description="Procura no que você escreveu e no que o Claude respondeu. Só lê as conversas guardadas no Nexus."
    >
      {workspace && <SearchPanel workspace={workspace} onClose={hide} />}
    </Dialog>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function SearchPanel({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const scopeProjectId = useChat((s) => s.scope[workspace.id] ?? null);
  const projects = useProjects(workspace.id).data;
  const project = projects?.find((p) => p.id === scopeProjectId) ?? null;
  const projectName = (id: string | null) => (id ? (projects?.find((p) => p.id === id)?.name ?? 'Projeto') : 'Geral');
  // Dentro de um projeto, a busca começa nele; "Todo o Workspace" amplia.
  const [where, setWhere] = useState<'project' | 'all'>(project ? 'project' : 'all');
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), DEBOUNCE_MS);
  const projectId = where === 'project' && project ? project.id : undefined;
  const ready = query.length >= SEARCH_MIN_LENGTH;
  const root = useRef<HTMLDivElement>(null);

  const result = useQuery({
    queryKey: ['search', workspace.id, projectId ?? 'todos', query],
    queryFn: () => invoke('conversations:search', { workspaceId: workspace.id, query, projectId }),
    enabled: ready,
    placeholderData: keepPreviousData,
    // Conversas mudam o tempo todo: sem reaproveitar resultados antigos.
    gcTime: 0,
    staleTime: 0,
  });
  const hits = ready && result.data ? result.data.hits : NO_HITS;
  const groups = useMemo(() => groupByConversation(hits), [hits]);

  function openHit(hit: SearchHit) {
    const chat = useChat.getState();
    chat.setScope(workspace.id, hit.projectId);
    chat.select(workspace.id, hit.conversationId);
    useLayout.getState().setView('chat');
    useSearch.getState().goTo(hit.conversationId, hit.messageId);
    onClose();
  }

  /** Setas passam do campo para os resultados e entre eles; Enter no campo abre o primeiro. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-hit]') ?? [])];
    const input = root.current?.querySelector<HTMLElement>('input[data-search-input]');
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      const next = items[at + 1];
      if (next) next.focus();
    } else if (e.key === 'ArrowUp') {
      if (at > 0) items[at - 1]!.focus();
      else if (at === 0) input?.focus();
    } else if (e.key === 'Enter' && document.activeElement === input && hits[0]) {
      openHit(hits[0]);
    } else {
      return;
    }
    e.preventDefault();
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} data-testid="search-panel">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 focus-within:border-accent">
        <Search size={15} className="shrink-0 text-muted" aria-hidden />
        <input
          type="text"
          role="searchbox"
          data-search-input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="O que você quer achar? Várias palavras: todas precisam aparecer"
          aria-label="Texto da busca"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-muted"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Onde buscar">
        <ScopeChip active={where === 'all'} onClick={() => setWhere('all')}>
          Todo o Workspace
        </ScopeChip>
        {project && (
          <ScopeChip active={where === 'project'} onClick={() => setWhere('project')}>
            Só em {project.name}
          </ScopeChip>
        )}
        <span className="ml-auto text-muted" aria-live="polite" data-testid="search-status">
          {!ready
            ? 'Digite ao menos 2 letras'
            : result.isPending || result.isPlaceholderData
              ? 'Procurando…'
              : hits.length === 0
                ? 'Nada encontrado'
                : `${hits.length} ${hits.length === 1 ? 'trecho' : 'trechos'}${result.data?.truncated ? ' (há mais; refine a busca)' : ''}`}
        </span>
      </div>

      {result.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {result.error.message}
        </p>
      )}

      {groups.length > 0 && (
        <ul
          className="mt-3 max-h-[min(55vh,28rem)] space-y-3 overflow-y-auto pr-1"
          aria-label="Resultados"
          data-testid="search-results"
        >
          {groups.map((g) => (
            <li key={g.conversationId}>
              <div className="flex items-center gap-2 px-1 pb-1 text-xs">
                <span className="min-w-0 truncate font-medium text-text">{g.title}</span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
                  {projectName(g.projectId)}
                </span>
              </div>
              <ul className="space-y-0.5">
                {g.hits.map((h) => (
                  <li key={h.messageId ?? 'titulo'}>
                    <button
                      type="button"
                      data-hit
                      onClick={() => openHit(h)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span
                        className={cn(
                          'mt-0.5 w-12 shrink-0 text-[11px]',
                          h.role === 'assistant' ? 'text-accent' : 'text-muted',
                        )}
                      >
                        {h.role === 'user' ? 'Você' : h.role === 'assistant' ? 'Claude' : 'Título'}
                      </span>
                      <span className="min-w-0 flex-1 leading-5 break-words text-text/90">
                        <Highlighted text={h.text} ranges={h.ranges} />
                      </span>
                      {h.role && (
                        <time
                          dateTime={h.createdAt}
                          title={formatFullTime(h.createdAt)}
                          className="mt-0.5 shrink-0 text-[11px] text-muted tabular-nums"
                        >
                          {formatMessageTime(h.createdAt)}
                        </time>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active
          ? 'border-accent bg-accent-soft text-text'
          : 'border-border text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/** O trecho com as palavras achadas em destaque. */
function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, s)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="rounded-sm bg-accent-soft px-0.5 text-text">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

interface Group {
  conversationId: string;
  title: string;
  projectId: string | null;
  hits: SearchHit[];
}

/** Os resultados já vêm agrupados por conversa; aqui só se separa cada grupo. */
function groupByConversation(hits: SearchHit[]): Group[] {
  const groups: Group[] = [];
  for (const h of hits) {
    const last = groups.at(-1);
    if (last?.conversationId === h.conversationId) last.hits.push(h);
    else
      groups.push({ conversationId: h.conversationId, title: h.conversationTitle, projectId: h.projectId, hits: [h] });
  }
  return groups;
}
