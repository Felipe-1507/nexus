import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SEARCH_MIN_LENGTH, type SearchHit } from '@shared/search';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useChat } from '@renderer/features/chat/chat-store';
import { invoke } from '@renderer/lib/ipc';
import { useSearch } from './search-store';

const DEBOUNCE_MS = 250;
const NO_HITS: SearchHit[] = [];

export function useDebounced<T>(value: T, ms: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Busca nas conversas do Workspace (ou de um projeto) enquanto o texto é digitado. Só lê o banco do Nexus. Sem texto
 * suficiente, não consulta nada.
 */
export function useConversationSearch(workspaceId: string, text: string, projectId?: string) {
  const query = useDebounced(text.trim());
  const ready = query.length >= SEARCH_MIN_LENGTH;
  const result = useQuery({
    queryKey: ['search', workspaceId, projectId ?? 'todos', query],
    queryFn: () => invoke('conversations:search', { workspaceId, query, projectId }),
    enabled: ready,
    placeholderData: keepPreviousData,
    // Conversas mudam o tempo todo: sem reaproveitar resultados antigos.
    gcTime: 0,
    staleTime: 0,
  });
  return {
    ready,
    pending: ready && (result.isPending || result.isPlaceholderData),
    error: result.isError ? result.error : null,
    hits: ready && result.data ? result.data.hits : NO_HITS,
    truncated: ready && Boolean(result.data?.truncated),
  };
}

/** Leva o usuário ao resultado: abre a conversa (trocando o escopo, se preciso) e a mensagem achada é destacada. */
export function openSearchHit(workspaceId: string, hit: SearchHit): void {
  const chat = useChat.getState();
  chat.setScope(workspaceId, hit.projectId);
  chat.select(workspaceId, hit.conversationId);
  useLayout.getState().setView('chat');
  useSearch.getState().goTo(hit.conversationId, hit.messageId);
}
