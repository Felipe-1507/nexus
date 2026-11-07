import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { noteKeys } from '@renderer/features/knowledge/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { invoke } from '@renderer/lib/ipc';
import type { GalaxyMode } from './GalaxyView';

// O Three.js fica fora do pacote inicial; é carregado quando a galáxia abre ou, antes disso, com o app ocioso.
type GalaxyModule = typeof import('./GalaxyView');
let galaxyModule: GalaxyModule | null = null;
const loadGalaxy = () =>
  import('./GalaxyView').then((m) => {
    galaxyModule = m;
    return m;
  });

/**
 * Galáxia sem `Suspense`: com o módulo já carregado (adiantado com o app ocioso), ela aparece no mesmo quadro. Com
 * `lazy`/`Suspense`, o React segurava a tela por mais de um segundo antes de mostrá-la, mesmo com tudo pronto.
 */
export function GalaxyScreen({ mode }: { mode: GalaxyMode }) {
  const [mod, setMod] = useState(galaxyModule);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!mod) loadGalaxy().then(setMod, setError);
  }, [mod]);
  if (error) throw error;
  if (!mod) return <p className="p-6 text-xs text-muted">Carregando a galáxia…</p>;
  return <mod.GalaxyView mode={mode} />;
}

const PREFETCH_DELAY_MS = 4_000;

/**
 * Com o app ocioso, adianta o código da galáxia e o grafo do Workspace ativo: abrir a galáxia fica imediato. O índice
 * de notas é o mesmo que o chat usa no prompt, então não é trabalho a mais.
 */
export function usePrefetchGalaxy(): void {
  const queryClient = useQueryClient();
  const activeId = useActiveWorkspace()?.id;
  useEffect(() => {
    const timer = setTimeout(() => {
      requestIdleCallback(() => {
        void loadGalaxy().catch(() => undefined);
        if (activeId) {
          void queryClient.prefetchQuery({
            queryKey: noteKeys.graph(activeId),
            queryFn: () => invoke('knowledge:graph', { workspaceId: activeId }),
          });
        }
      });
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeId, queryClient]);
}
