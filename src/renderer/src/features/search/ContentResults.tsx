import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, StickyNote } from 'lucide-react';
import { useEffect } from 'react';
import { SEARCH_MIN_LENGTH } from '@shared/search';
import type { ContentHit } from '@shared/content-search';
import { useLayout } from '@renderer/app/shell/layout-store';
import { invoke } from '@renderer/lib/ipc';
import { Highlighted } from './Highlighted';
import { useDebounced } from './queries';

/** Resultados da busca no texto das notas ou nos arquivos dos projetos. Em `onStatus`, o resumo para o cabeçalho. */
export function ContentResults({
  workspaceId,
  kind,
  text,
  projectId,
  onOpen,
  onStatus,
}: {
  workspaceId: string;
  kind: 'notes' | 'files';
  text: string;
  projectId?: string;
  onOpen: () => void;
  onStatus: (status: string) => void;
}) {
  const query = useDebounced(text.trim());
  const ready = query.length >= SEARCH_MIN_LENGTH;
  const result = useQuery({
    queryKey: ['search-content', workspaceId, kind, projectId ?? 'todos', query],
    queryFn: () => invoke('search:content', { workspaceId, query, kind, projectId }),
    enabled: ready,
    placeholderData: keepPreviousData,
    // Os arquivos mudam por fora (o Claude, o VS Code): sem reaproveitar resultados antigos.
    gcTime: 0,
    staleTime: 0,
  });
  const openNote = useLayout((s) => s.openNote);
  const openCode = useLayout((s) => s.openCode);
  const pending = ready && (result.isPending || result.isPlaceholderData);
  const data = ready ? result.data : undefined;
  const hits = data?.hits ?? [];

  const status = !ready
    ? 'Digite ao menos 2 letras'
    : pending
      ? 'Procurando…'
      : hits.length === 0
        ? data?.incomplete
          ? `Nada encontrado em ${data.scanned.toLocaleString('pt-BR')} arquivos (a busca parou no limite)`
          : 'Nada encontrado'
        : `${hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}${data?.truncated ? ' (há mais; refine a busca)' : data?.incomplete ? ' (a busca parou no limite; pode haver mais)' : ''}`;
  useEffect(() => onStatus(status), [status, onStatus]);

  function open(hit: ContentHit) {
    if (hit.kind === 'note') openNote(workspaceId, hit.path);
    else openCode({ workspaceId, projectId: hit.projectId, path: hit.path });
    onOpen();
  }

  return (
    <>
      {result.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {result.error.message}
        </p>
      )}
      {hits.length > 0 && (
        <ul
          className="mt-3 max-h-[min(55vh,28rem)] space-y-0.5 overflow-y-auto pr-1"
          aria-label="Resultados"
          data-testid="search-results"
        >
          {hits.map((h) => (
            <li key={`${h.projectId ?? ''}:${h.path}`}>
              <button
                type="button"
                data-hit
                onClick={() => open(h)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {h.kind === 'note' ? (
                  <StickyNote size={14} className="mt-1 shrink-0 text-accent" aria-hidden />
                ) : (
                  <FileText size={14} className="mt-1 shrink-0 text-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{h.name}</span>
                    <span className="min-w-0 truncate text-[11px] text-muted" title={h.path}>
                      {h.kind === 'file' ? `${h.projectName} · ${h.path}` : h.path}
                      {h.line ? ` · linha ${h.line}` : ''}
                    </span>
                  </span>
                  {h.text && (
                    <span className="block leading-5 break-words text-text/90">
                      <Highlighted text={h.text} ranges={h.ranges} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
