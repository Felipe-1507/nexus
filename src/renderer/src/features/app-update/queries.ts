import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/lib/ipc';

export const appUpdateKeys = {
  settings: ['appUpdate', 'settings'] as const,
  status: ['appUpdate', 'status'] as const,
};

export function useAppUpdateSettings() {
  return useQuery({ queryKey: appUpdateKeys.settings, queryFn: () => invoke('appUpdate:settings') });
}

/** Estado da atualização do Nexus. A consulta (pasta ou endereço) é guardada por horas no processo principal. */
export function useAppUpdateStatus() {
  return useQuery({
    queryKey: appUpdateKeys.status,
    queryFn: () => invoke('appUpdate:status', { refresh: false }),
    staleTime: 30 * 60_000,
  });
}

export function useSetAppUpdateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: string | null) => invoke('appUpdate:setSettings', { source }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(appUpdateKeys.settings, settings);
      // Mudou o lugar de consulta: o estado antigo não vale mais.
      await queryClient.invalidateQueries({ queryKey: appUpdateKeys.status });
    },
  });
}

export function useCheckAppUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('appUpdate:status', { refresh: true }),
    onSuccess: (status) => queryClient.setQueryData(appUpdateKeys.status, status),
  });
}

export function useInstallAppUpdate() {
  return useMutation({ mutationFn: () => invoke('appUpdate:install') });
}
