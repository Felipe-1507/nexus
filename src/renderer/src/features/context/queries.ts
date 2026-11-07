import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ContextThresholds } from '@shared/context';
import { invoke } from '@renderer/lib/ipc';

export const contextKeys = {
  /** Prefixo: invalida tudo do medidor (usado no fim de cada resposta). */
  all: ['context'] as const,
  state: (conversationId: string) => ['context', 'state', conversationId] as const,
  overview: (workspaceId: string) => ['context', 'overview', workspaceId] as const,
  preview: (conversationId: string) => ['context', 'preview', conversationId] as const,
  thresholds: ['context', 'thresholds'] as const,
};

/** Medição da conversa. Lê dados já gravados (nenhuma chamada ao Claude), então pode ser pedida sempre que a conversa abre. */
export function useContextState(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.state(conversationId ?? ''),
    queryFn: () => invoke('context:get', { conversationId: conversationId! }),
    enabled: Boolean(conversationId),
  });
}

export function useContextOverview(workspaceId: string | undefined) {
  return useQuery({
    queryKey: contextKeys.overview(workspaceId ?? ''),
    queryFn: () => invoke('context:overview', { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
    // Reabrir o painel mostra o que há na hora; o que muda com o tempo (cache) é recalculado na tela.
    staleTime: 0,
  });
}

export function useContinuationPreview(conversationId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: contextKeys.preview(conversationId ?? ''),
    queryFn: () => invoke('context:continuePreview', { conversationId: conversationId! }),
    enabled: enabled && Boolean(conversationId),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useContinueConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; structuredSummary: boolean }) => invoke('context:continue', input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: contextKeys.all });
    },
  });
}

export function useContextThresholds() {
  return useQuery({ queryKey: contextKeys.thresholds, queryFn: () => invoke('context:thresholds') });
}

export function useSetContextThresholds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (thresholds: ContextThresholds) => invoke('context:setThresholds', thresholds),
    onSuccess: (thresholds) => {
      queryClient.setQueryData(contextKeys.thresholds, thresholds);
      void queryClient.invalidateQueries({ queryKey: contextKeys.all });
    },
  });
}

/** Relógio da tela: o tempo parado e a situação do cache mudam sem que nenhum dado novo chegue. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
