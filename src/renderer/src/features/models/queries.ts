import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelChoice } from '@shared/models';
import { invoke } from '@renderer/lib/ipc';
import { chatKeys } from '@renderer/features/chat/queries';
import { useClaudeStatus } from '@renderer/features/claude/queries';
import { workspaceKeys } from '@renderer/features/workspaces/queries';

const catalogKey = ['models'] as const;

/** Modelos disponíveis para a conta conectada (lidos do Claude Code, sem consumir tokens). */
export function useModelCatalog() {
  const claude = useClaudeStatus();
  return useQuery({
    queryKey: catalogKey,
    queryFn: () => invoke('models:list', { refresh: false }),
    enabled: Boolean(claude.data?.ready),
    staleTime: Infinity,
  });
}

export function useSetConversationModel(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModelChoice & { conversationId: string }) => invoke('conversations:setModel', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.conversations(workspaceId) }),
  });
}

export function useSetWorkspaceDefaultModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModelChoice & { id: string }) => invoke('workspaces:setDefaultModel', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.list }),
  });
}
