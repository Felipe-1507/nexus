import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectInput, Project } from '@shared/project';
import { invoke } from '@renderer/lib/ipc';
import { chatKeys } from '@renderer/features/chat/queries';

export const projectKeys = {
  list: (workspaceId: string) => ['projects', workspaceId] as const,
  sessions: (projectId: string) => ['projects', 'sessions', projectId] as const,
};

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId ?? ''),
    queryFn: () => invoke('projects:list', { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['projects'] });
}

export function useInspectFolder() {
  return useMutation({
    mutationFn: (input: { workspaceId: string; path: string }) => invoke('projects:inspectFolder', input),
  });
}

export function usePickFolder() {
  return useMutation({ mutationFn: () => invoke('projects:pickFolder') });
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => invoke('projects:create', input),
    onSuccess: invalidate,
  });
}

export function useSetProjectInstructions() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (input: { id: string; instructions: string }) => invoke('projects:setInstructions', input),
    onSuccess: invalidate,
  });
}

export function useProjectTrust() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, trust }: { id: string; trust: boolean }) =>
      invoke(trust ? 'projects:trust' : 'projects:revokeTrust', { id }),
    onSuccess: invalidate,
  });
}

export function useArchiveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({ mutationFn: (id: string) => invoke('projects:archive', { id }), onSuccess: invalidate });
}

/** Grava a nova ordem; a lista muda na hora e volta ao que o banco disser se a gravação falhar. */
export function useReorderProjects(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = projectKeys.list(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => invoke('projects:reorder', { workspaceId, ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Project[]>(key, (old) =>
        old ? ids.map((id) => old.find((p) => p.id === id)).filter((p): p is Project => Boolean(p)) : old,
      );
    },
    onSuccess: (projects) => queryClient.setQueryData(key, projects),
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useClaudeSessions(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: projectKeys.sessions(projectId),
    queryFn: () => invoke('projects:claudeSessions', { projectId }),
    enabled,
  });
}

export function useImportSession(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; sessionId: string }) => invoke('projects:importSession', input),
    onSuccess: (_c, input) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.sessions(input.projectId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations(workspaceId) });
    },
  });
}
