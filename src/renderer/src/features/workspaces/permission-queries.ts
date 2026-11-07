import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionMode } from '@shared/permissions';
import { invoke } from '@renderer/lib/ipc';
import { workspaceKeys } from './queries';

const keys = {
  rules: (workspaceId: string) => ['permissions', workspaceId, 'rules'] as const,
  audit: (workspaceId: string) => ['permissions', workspaceId, 'audit'] as const,
};

export function useSetPermissionMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; mode: PermissionMode }) => invoke('workspaces:setPermissionMode', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.list }),
  });
}

export function usePermissionRules(workspaceId: string) {
  return useQuery({ queryKey: keys.rules(workspaceId), queryFn: () => invoke('permissions:rules', { workspaceId }) });
}

export function useRemoveRule(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => invoke('permissions:removeRule', { ruleId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.rules(workspaceId) }),
  });
}

export function usePermissionAudit(workspaceId: string) {
  return useQuery({
    queryKey: keys.audit(workspaceId),
    queryFn: () => invoke('permissions:audit', { workspaceId }),
    // O histórico muda a cada decisão; ao abrir a página sempre busca de novo.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
