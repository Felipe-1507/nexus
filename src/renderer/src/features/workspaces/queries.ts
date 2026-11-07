import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceList } from '@shared/ipc-contract';
import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from '@shared/workspace';
import { invoke } from '@renderer/lib/ipc';

export const workspaceKeys = {
  list: ['workspaces'] as const,
  instructions: (id: string) => ['workspaces', id, 'instructions'] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: workspaceKeys.list, queryFn: () => invoke('workspaces:list') });
}

/** Workspace ativo (ou null quando não há nenhum). */
export function useActiveWorkspace(): Workspace | null {
  const { data } = useWorkspaces();
  return data?.workspaces.find((w) => w.id === data.activeId) ?? null;
}

function useInvalidateList() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: workspaceKeys.list });
}

export function useCreateWorkspace() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => invoke('workspaces:create', input),
    onSuccess: invalidate,
  });
}

export function useUpdateWorkspace() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => invoke('workspaces:update', input),
    onSuccess: invalidate,
  });
}

export function useArchiveWorkspace() {
  const invalidate = useInvalidateList();
  return useMutation({ mutationFn: (id: string) => invoke('workspaces:archive', { id }), onSuccess: invalidate });
}

export function useSetActiveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke('workspaces:setActive', { id }),
    // Troca na hora; o main confirma em seguida.
    onMutate: (id) =>
      queryClient.setQueryData<WorkspaceList>(workspaceKeys.list, (old) => (old ? { ...old, activeId: id } : old)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.list }),
  });
}

export function useOpenWorkspaceFolder() {
  return useMutation({ mutationFn: (id: string) => invoke('workspaces:openFolder', { id }) });
}

export function useInstructions(id: string) {
  return useQuery({
    queryKey: workspaceKeys.instructions(id),
    queryFn: () => invoke('workspaces:readInstructions', { id }),
    staleTime: Infinity,
  });
}
