import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CodeScope } from '@shared/code';
import { invoke } from '@renderer/lib/ipc';

export const codeKeys = {
  list: (s: CodeScope, dir: string) => ['code', s.workspaceId, s.projectId ?? 'ws', 'list', dir] as const,
  file: (s: CodeScope, path: string) => ['code', s.workspaceId, s.projectId ?? 'ws', 'file', path] as const,
  changes: (messageId: string) => ['code', 'changes', messageId] as const,
};

export function useCodeList(scope: CodeScope, dir: string, enabled = true) {
  return useQuery({
    queryKey: codeKeys.list(scope, dir),
    queryFn: () => invoke('code:list', { ...scope, dir }),
    enabled,
  });
}

export function useCodeFile(scope: CodeScope, path: string) {
  return useQuery({
    queryKey: codeKeys.file(scope, path),
    queryFn: () => invoke('code:read', { ...scope, path }),
    staleTime: 0,
  });
}

export function useFileChanges(messageId: string) {
  return useQuery({
    queryKey: codeKeys.changes(messageId),
    queryFn: () => invoke('code:changes', { messageId }),
    staleTime: Infinity,
  });
}

export function useOpenInVsCode() {
  return useMutation({ mutationFn: (input: CodeScope & { path: string }) => invoke('code:openInVsCode', input) });
}

/** Depois de colar ou excluir, as pastas já listadas são lidas de novo. */
function useRefreshTree(scope: CodeScope) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ['code', scope.workspaceId, scope.projectId ?? 'ws', 'list'] });
}

export function useImportPaths(scope: CodeScope) {
  const refresh = useRefreshTree(scope);
  return useMutation({
    mutationFn: (input: { dir: string; sources: string[] }) => invoke('code:import', { ...scope, ...input }),
    onSettled: refresh,
  });
}

export function useDeleteEntry(scope: CodeScope) {
  const refresh = useRefreshTree(scope);
  return useMutation({
    mutationFn: (path: string) => invoke('code:delete', { ...scope, path }),
    onSettled: refresh,
  });
}
