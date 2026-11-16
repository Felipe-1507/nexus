import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CODE_EVENT_CHANNEL, type CodeEvent, type CodeScope } from '@shared/code';
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

/**
 * Mantém a árvore de arquivos em dia com o disco: observa as pastas abertas (copiar algo pelo Explorer, o Claude criando
 * arquivos, outro programa) e relê só a pasta que mudou. Ao voltar para a janela, relê as abertas, o que cobre também as
 * pastas de rede, onde o sistema nem sempre avisa.
 */
export function useCodeTreeSync(scope: CodeScope, openDirs: string[]): void {
  const queryClient = useQueryClient();
  const { workspaceId, projectId } = scope;
  // Chave estável: o efeito só roda quando o conjunto de pastas abertas muda de verdade.
  const dirsKey = JSON.stringify([...openDirs].sort());

  useEffect(() => {
    const dirs = JSON.parse(dirsKey) as string[];
    void invoke('code:watch', { workspaceId, projectId, dirs: ['', ...dirs] }).catch(() => undefined);
    return () => {
      void invoke('code:watch', { workspaceId, projectId, dirs: [] }).catch(() => undefined);
    };
  }, [workspaceId, projectId, dirsKey]);

  useEffect(() => {
    const off = window.nexus.on(CODE_EVENT_CHANNEL, (payload) => {
      const event = payload as CodeEvent;
      if (event.workspaceId !== workspaceId || event.projectId !== projectId) return;
      for (const dir of event.dirs)
        void queryClient.invalidateQueries({ queryKey: codeKeys.list({ workspaceId, projectId }, dir) });
    });
    const onFocus = () =>
      void queryClient.invalidateQueries({ queryKey: ['code', workspaceId, projectId ?? 'ws', 'list'] });
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [queryClient, workspaceId, projectId]);
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

export function useCopyEntries(scope: CodeScope) {
  const refresh = useRefreshTree(scope);
  return useMutation({
    mutationFn: (input: { dir: string; paths: string[] }) => invoke('code:copy', { ...scope, ...input }),
    onSettled: refresh,
  });
}

export function useRenameEntry(scope: CodeScope) {
  const refresh = useRefreshTree(scope);
  return useMutation({
    mutationFn: (input: { path: string; name: string }) => invoke('code:rename', { ...scope, ...input }),
    onSettled: refresh,
  });
}

export function useRevealEntry(scope: CodeScope) {
  return useMutation({ mutationFn: (path: string) => invoke('code:reveal', { ...scope, path }) });
}

export function useDeleteEntry(scope: CodeScope) {
  const refresh = useRefreshTree(scope);
  return useMutation({
    mutationFn: (path: string) => invoke('code:delete', { ...scope, path }),
    onSettled: refresh,
  });
}
