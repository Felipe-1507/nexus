import { lazy, Suspense } from 'react';

// O Monaco é pesado: só carrega quando o código é aberto (no centro ou no painel lateral).
const CodePanel = lazy(() => import('@renderer/features/code/CodePanel').then((m) => ({ default: m.CodePanel })));

export function CodeScreen() {
  return (
    <Suspense fallback={<p className="p-4 text-xs text-muted">Carregando…</p>}>
      <CodePanel />
    </Suspense>
  );
}
