import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WelcomeDue, WelcomeSettings } from '@shared/welcome';
import { useLayout } from '@renderer/app/shell/layout-store';
import { invoke } from '@renderer/lib/ipc';
import { useWelcome } from './welcome-store';

export const welcomeKeys = {
  settings: ['welcome', 'settings'] as const,
  due: ['welcome', 'due'] as const,
  recap: (since: string) => ['welcome', 'recap', since] as const,
};

export const fetchDue = (force: boolean) => invoke('welcome:due', { force });

export function useWelcomeSettings() {
  return useQuery({ queryKey: welcomeKeys.settings, queryFn: () => invoke('welcome:settings') });
}

export function useSetWelcomeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<WelcomeSettings>) => invoke('welcome:setSettings', patch),
    onSuccess: (settings) => queryClient.setQueryData(welcomeKeys.settings, settings),
  });
}

/** Abre a tela de boas-vindas por cima da galáxia; ao fechar, o app volta para onde estava. */
export function openWelcome(due: WelcomeDue, workspaceId: string): void {
  const layout = useLayout.getState();
  useWelcome.getState().open({ due, workspaceId, returnView: layout.view });
  layout.setView('galaxy');
}

/**
 * Resumo do período; só roda com a tela aberta. O texto local chega na hora; com o Claude ligado, uma segunda busca
 * traz o texto dele e substitui o local quando ficar pronto (a tela nunca espera a IA).
 */
export function useWelcomeRecap(workspaceId: string, since: string, label: string) {
  const ai = useWelcomeSettings().data?.ai ?? false;
  const local = useQuery({
    queryKey: [...welcomeKeys.recap(since), 'local'],
    queryFn: () => invoke('welcome:recap', { workspaceId, since, label, ai: false }),
    staleTime: Infinity,
    gcTime: 0,
  });
  const claude = useQuery({
    queryKey: [...welcomeKeys.recap(since), 'claude'],
    queryFn: () => invoke('welcome:recap', { workspaceId, since, label, ai: true }),
    enabled: ai && local.isSuccess && local.data.items.length > 0,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const data = claude.data ?? local.data;
  return {
    data,
    isPending: local.isPending,
    isError: local.isError,
    error: local.error,
    isSuccess: local.isSuccess,
    /** O Claude ainda está reescrevendo o texto. */
    refining: claude.isFetching,
  };
}
