import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@renderer/lib/ipc';
import { useChat } from '@renderer/features/chat/chat-store';

/** O que o Claude está fazendo num projeto (ou nas conversas gerais), pelo conjunto das conversas dele. */
export type ProjectActivity = 'approval' | 'working' | 'done';

/** Chave das conversas gerais do Workspace (sem projeto). */
export const GENERAL = '__geral__';

/**
 * Estado de cada projeto, calculado só com o que o Nexus já sabe (sem IA): pedindo aprovação > trabalhando > resposta
 * nova ainda não vista. A conversa aberta agora não conta como "resposta nova" (o store já não a marca).
 */
export function projectActivity(
  projectOf: ReadonlyMap<string, string | null>,
  live: Readonly<Record<string, unknown>>,
  pending: Readonly<Record<string, readonly unknown[] | undefined>>,
  unread: Readonly<Record<string, true>>,
): Record<string, ProjectActivity> {
  const out: Record<string, ProjectActivity> = {};
  const rank = { done: 1, working: 2, approval: 3 } as const;
  const mark = (conversationId: string, state: ProjectActivity) => {
    if (!projectOf.has(conversationId)) return;
    const key = projectOf.get(conversationId) ?? GENERAL;
    const prev = out[key];
    if (!prev || rank[state] > rank[prev]) out[key] = state;
  };
  for (const id of Object.keys(unread)) mark(id, 'done');
  for (const id of Object.keys(live)) mark(id, 'working');
  for (const [id, list] of Object.entries(pending)) if ((list?.length ?? 0) > 0) mark(id, 'approval');
  return out;
}

/** Estado dos projetos do Workspace. Busca a lista de todas as conversas e a recarrega quando aparece uma desconhecida. */
export function useProjectActivity(workspaceId: string | undefined): Record<string, ProjectActivity> {
  const live = useChat((s) => s.live);
  const pending = useChat((s) => s.pending);
  const unread = useChat((s) => s.unread);
  const all = useQuery({
    queryKey: ['chat', 'all-conversations', workspaceId ?? ''],
    queryFn: () => invoke('conversations:list', { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const projectOf = useMemo(() => new Map((all.data ?? []).map((c) => [c.id, c.projectId] as const)), [all.data]);
  // Conversa nova (ou de outro Workspace): recarrega uma vez por id desconhecido, nunca em laço.
  const tried = useRef(new Set<string>());
  const fresh = [...Object.keys(live), ...Object.keys(unread), ...Object.keys(pending)].filter(
    (id) => !projectOf.has(id) && !tried.current.has(id),
  );
  const key = fresh.join(',');
  const { refetch } = all;
  useEffect(() => {
    if (!key || !workspaceId) return;
    for (const id of key.split(',')) tried.current.add(id);
    void refetch();
  }, [key, workspaceId, refetch]);
  return useMemo(() => projectActivity(projectOf, live, pending, unread), [projectOf, live, pending, unread]);
}
