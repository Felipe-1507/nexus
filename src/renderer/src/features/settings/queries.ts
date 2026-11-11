import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { GalaxyQuality, OpenablePath, Theme } from '@shared/ipc-contract';
import type { Appearance } from '@shared/palette';
import { applyAppearance } from '@renderer/lib/appearance';
import { invoke } from '@renderer/lib/ipc';

export const settingsKeys = {
  appInfo: ['app', 'info'] as const,
  preferences: ['preferences'] as const,
  appearance: ['appearance'] as const,
  galaxyQuality: ['galaxy', 'quality'] as const,
};

export function useAppInfo() {
  return useQuery({ queryKey: settingsKeys.appInfo, queryFn: () => invoke('app:getInfo'), staleTime: Infinity });
}

export function usePreferences() {
  return useQuery({ queryKey: settingsKeys.preferences, queryFn: () => invoke('preferences:get') });
}

export function useSetTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (theme: Theme) => invoke('preferences:setTheme', theme),
    onSuccess: (prefs) => queryClient.setQueryData(settingsKeys.preferences, prefs),
  });
}

/** Variação do tema escuro e cor de destaque. As cores mudam na hora (antes de o main confirmar). */
export function useAppearance() {
  return useQuery({ queryKey: settingsKeys.appearance, queryFn: () => invoke('appearance:get'), staleTime: Infinity });
}

export function useSetAppearance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Appearance>) => invoke('appearance:set', patch),
    onMutate: (patch) => {
      const previous = queryClient.getQueryData<Appearance>(settingsKeys.appearance);
      if (previous) applyAppearance({ ...previous, ...patch });
      return { previous };
    },
    onSuccess: (appearance) => {
      queryClient.setQueryData(settingsKeys.appearance, appearance);
      applyAppearance(appearance);
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) applyAppearance(context.previous);
    },
  });
}

/** Mantém a página com as cores salvas (no app instalado o main já as entrega na página; em desenvolvimento, não). */
export function useAppearanceSync(): void {
  const { data } = useAppearance();
  useEffect(() => {
    if (data) applyAppearance(data);
  }, [data]);
}

export function useGalaxyQuality() {
  return useQuery({ queryKey: settingsKeys.galaxyQuality, queryFn: () => invoke('galaxy:getQuality') });
}

export function useSetGalaxyQuality() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quality: GalaxyQuality) => invoke('galaxy:setQuality', quality),
    onSuccess: (data) => queryClient.setQueryData(settingsKeys.galaxyQuality, data),
  });
}

export function useOpenPath() {
  return useMutation({ mutationFn: (key: OpenablePath) => invoke('app:openPath', key) });
}
