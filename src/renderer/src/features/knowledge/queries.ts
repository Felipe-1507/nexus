import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { KnowledgeEvent, PlanetStyles } from '@shared/knowledge';
import type { PlanetOverride } from '@shared/planets';
import { invoke } from '@renderer/lib/ipc';

export const noteKeys = {
  all: (workspaceId: string) => ['knowledge', workspaceId] as const,
  tree: (workspaceId: string) => ['knowledge', workspaceId, 'tree'] as const,
  note: (workspaceId: string, path: string) => ['knowledge', workspaceId, 'note', path] as const,
  links: (workspaceId: string, path: string) => ['knowledge', workspaceId, 'links', path] as const,
  graph: (workspaceId: string) => ['knowledge', workspaceId, 'graph'] as const,
  planets: (workspaceId: string) => ['knowledge', workspaceId, 'planets'] as const,
};

export function useNoteTree(workspaceId: string | undefined) {
  return useQuery({
    queryKey: noteKeys.tree(workspaceId ?? ''),
    queryFn: () => invoke('knowledge:tree', { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useNote(workspaceId: string, path: string) {
  return useQuery({
    queryKey: noteKeys.note(workspaceId, path),
    queryFn: () => invoke('knowledge:read', { workspaceId, path }),
    staleTime: Infinity,
  });
}

export function useNoteLinks(workspaceId: string, path: string) {
  return useQuery({
    queryKey: noteKeys.links(workspaceId, path),
    queryFn: () => invoke('knowledge:links', { workspaceId, path }),
  });
}

/** Notas e links do vault inteiro, para a galáxia. Recarrega sozinho quando o vault muda. */
export function useGalaxyGraph(workspaceId: string) {
  return useQuery({
    queryKey: noteKeys.graph(workspaceId),
    queryFn: () => invoke('knowledge:graph', { workspaceId }),
  });
}

/** O que o usuário escolheu para a aparência dos planetas (só o que ele trocou). */
export function useGalaxyStyles(workspaceId: string) {
  return useQuery({
    queryKey: noteKeys.planets(workspaceId),
    queryFn: () => invoke('galaxy:styles', { workspaceId }),
    staleTime: Infinity,
  });
}

/** Troca a aparência de um planeta; aparece na hora e é gravada em seguida. `override: null` volta ao sorteio. */
export function useSetPlanetStyle(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; override: PlanetOverride | null }) =>
      invoke('galaxy:setPlanet', { workspaceId, ...input }),
    onMutate: ({ path, override }) => {
      queryClient.setQueryData<PlanetStyles>(noteKeys.planets(workspaceId), (old) => {
        const next = { ...old };
        if (override && Object.keys(override).length > 0) next[path] = override;
        else delete next[path];
        return next;
      });
    },
    onSuccess: (styles) => queryClient.setQueryData(noteKeys.planets(workspaceId), styles),
    onError: () => void queryClient.invalidateQueries({ queryKey: noteKeys.planets(workspaceId) }),
  });
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: noteKeys.tree(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: noteKeys.graph(workspaceId) }),
    ]);
}

export function useCreateNote(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { folder: string; title: string }) => invoke('knowledge:create', { workspaceId, ...input }),
    onSuccess: invalidate,
  });
}

export function useCreateFolder(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { parent: string; title: string }) =>
      invoke('knowledge:createFolder', { workspaceId, ...input }),
    onSuccess: invalidate,
  });
}

export function useRenameNote(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { path: string; title: string }) => invoke('knowledge:rename', { workspaceId, ...input }),
    onSuccess: invalidate,
  });
}

export function useTrashNote(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (path: string) => invoke('knowledge:trash', { workspaceId, path }),
    onSuccess: invalidate,
  });
}

/**
 * Mantém a tela em dia quando notas mudam por fora (o Claude, o Obsidian, outro editor): recarrega a árvore, os
 * links e as notas afetadas. O editor aberto decide se recarrega ou avisa do conflito.
 */
export function useKnowledgeEvents(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.nexus.on('knowledge:event', (payload) => {
        const event = payload as KnowledgeEvent;
        void queryClient.invalidateQueries({ queryKey: noteKeys.tree(event.workspaceId) });
        void queryClient.invalidateQueries({ queryKey: ['knowledge', event.workspaceId, 'links'] });
        void queryClient.invalidateQueries({ queryKey: noteKeys.graph(event.workspaceId) });
        for (const p of event.paths)
          void queryClient.invalidateQueries({ queryKey: noteKeys.note(event.workspaceId, p) });
      }),
    [queryClient],
  );
}
