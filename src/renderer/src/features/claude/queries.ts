import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { invoke } from '@renderer/lib/ipc';

const key = ['claude', 'status'] as const;

/** Diagnóstico do Claude Code. O main reaproveita a verificação feita na abertura do app. */
export function useClaudeStatus() {
  return useQuery({ queryKey: key, queryFn: () => invoke('claude:status', { refresh: false }), staleTime: Infinity });
}

export function useRefreshClaudeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('claude:status', { refresh: true }),
    onSuccess: (status) => queryClient.setQueryData(key, status),
  });
}

const WATCH_MS = 10 * 60_000;
const POLL_MS = 3_000;

/** Até quando verificar sozinho, depois que o usuário abriu o instalador ou o login. */
export const useClaudeWatch = create<{ until: number; watch: () => void; stop: () => void }>((set) => ({
  until: 0,
  watch: () => set({ until: Date.now() + WATCH_MS }),
  stop: () => set({ until: 0 }),
}));

/** Instalar e entrar com a conta: abrem uma janela fora do app, e o Nexus passa a verificar sozinho. */
export function useClaudeSetup() {
  const watch = useClaudeWatch((s) => s.watch);
  const install = useMutation({ mutationFn: () => invoke('claude:install'), onSuccess: watch });
  const login = useMutation({ mutationFn: () => invoke('claude:login'), onSuccess: watch });
  return { install, login };
}

/**
 * Enquanto o Claude não está pronto, verifica de novo quando a janela volta a ter foco (o usuário voltou do
 * terminal ou do navegador) e, depois de um clique em Instalar ou Entrar, a cada poucos segundos. Não consome tokens.
 */
export function useClaudeAutoCheck() {
  const queryClient = useQueryClient();
  const ready = useClaudeStatus().data?.ready;
  const until = useClaudeWatch((s) => s.until);

  useEffect(() => {
    if (ready === true && until > 0) useClaudeWatch.getState().stop();
    if (ready !== false) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        queryClient.setQueryData(key, await invoke('claude:status', { refresh: true }));
      } catch {
        // A próxima verificação tenta de novo; o painel nas Configurações mostra o erro se o usuário pedir.
      } finally {
        busy = false;
      }
    };
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    const timer =
      until > Date.now()
        ? setInterval(() => {
            if (Date.now() <= until) return void check();
            clearInterval(timer);
            useClaudeWatch.getState().stop();
          }, POLL_MS)
        : undefined;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (timer) clearInterval(timer);
    };
  }, [ready, until, queryClient]);
}

const updateKey = ['claude', 'update'] as const;
const newsKey = ['models', 'news'] as const;

/** Versão do Claude Code instalada x a mais nova. O main consulta a internet no máximo a cada 6 horas. */
export function useClaudeUpdate() {
  const ready = useClaudeStatus().data?.ready;
  return useQuery({
    queryKey: updateKey,
    queryFn: () => invoke('claude:updateCheck', { refresh: false }),
    enabled: ready !== undefined,
    staleTime: Infinity,
  });
}

/** Modelos que apareceram desde a última vez que o usuário viu a lista. */
export function useNewModels() {
  const ready = useClaudeStatus().data?.ready;
  return useQuery({
    queryKey: newsKey,
    queryFn: () => invoke('models:news'),
    enabled: ready === true,
    staleTime: Infinity,
  });
}

export function useMarkModelsSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('models:markSeen'),
    onSuccess: () => queryClient.setQueryData(newsKey, []),
  });
}

/**
 * Abre `claude update` num console. Quando o usuário volta para o Nexus, a versão é conferida de novo (sem esperar
 * as 6 horas); se mudou, a lista de modelos é lida outra vez e o aviso de modelo novo aparece se houver.
 */
export function useClaudeUpdater() {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const start = useMutation({ mutationFn: () => invoke('claude:update'), onSuccess: () => setUpdating(true) });

  useEffect(() => {
    if (!updating) return;
    const check = async () => {
      try {
        const status = await invoke('claude:status', { refresh: true });
        queryClient.setQueryData(key, status);
        const next = await invoke('claude:updateCheck', { refresh: true });
        queryClient.setQueryData(updateKey, next);
        if (!next.available) {
          setUpdating(false);
          await invoke('models:list', { refresh: true });
          await queryClient.invalidateQueries({ queryKey: ['models'] });
        }
      } catch {
        // Tenta de novo no próximo foco.
      }
    };
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [updating, queryClient]);

  return { start, updating, cancel: () => setUpdating(false) };
}
