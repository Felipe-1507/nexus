import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { Button } from '@renderer/components/ui/Button';
import { invoke } from '@renderer/lib/ipc';
import { Shell } from './shell/Shell';

// Os dados vêm do processo local: não há rede para tentar de novo nem foco de janela para revalidar.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <ErrorBoundary fallback={(error) => <AppError error={error} />}>
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

/** Último recurso, quando o próprio shell quebrou. Recarregar não interrompe as conversas, que rodam no main. */
function AppError({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="drag h-10 shrink-0" />
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-danger">
          <TriangleAlert size={22} />
        </div>
        <div>
          <h1 className="text-base font-semibold">Algo deu errado na interface</h1>
          <p className="mt-1 max-w-md text-sm break-words text-muted">{error.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
          <Button onClick={() => void invoke('app:openPath', 'logs').catch(() => undefined)}>
            Abrir pasta de logs
          </Button>
        </div>
      </div>
    </div>
  );
}
