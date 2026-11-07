import { useQuery, type QueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/lib/ipc';
import { useClaudeStatus } from './queries';

export const usageKey = ['usage'] as const;

/** Uso do plano. Lido do Claude Code sem gastar tokens; se atualiza a cada poucos minutos e quando uma resposta termina. */
export function useUsage() {
  const ready = useClaudeStatus().data?.ready;
  return useQuery({
    queryKey: usageKey,
    queryFn: () => invoke('usage:get', { refresh: false }),
    enabled: Boolean(ready),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
}

/** Lê de novo agora (ignorando o cache do main). Falhas ficam em silêncio: o medidor só mantém o último valor. */
export function refreshUsage(queryClient: QueryClient): Promise<void> {
  return invoke('usage:get', { refresh: true }).then(
    (usage) => void queryClient.setQueryData(usageKey, usage),
    () => undefined,
  );
}
