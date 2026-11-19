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

/** Resumo do período; só roda com a tela aberta. */
export function useWelcomeRecap(workspaceId: string, since: string, label: string) {
  return useQuery({
    queryKey: welcomeKeys.recap(since),
    queryFn: () => invoke('welcome:recap', { workspaceId, since, label }),
    staleTime: Infinity,
    gcTime: 0,
  });
}
