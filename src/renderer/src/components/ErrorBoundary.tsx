import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@renderer/components/ui/Button';
import { reportError } from '@renderer/lib/report-error';

interface Props {
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

/** Troca a parte da tela que quebrou por um aviso, em vez de deixar a janela em branco. O erro vai para o log. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError('render', error, info.componentStack ?? undefined);
  }

  reset = () => this.setState({ error: null });

  override render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

/** Aviso para um painel que quebrou: o resto do app continua funcionando. */
export function PanelError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="grid size-10 place-items-center rounded-xl bg-surface-2 text-danger">
        <TriangleAlert size={18} />
      </div>
      <div>
        <p className="text-sm font-medium">Esta parte da tela teve um erro</p>
        <p className="mt-1 max-w-80 text-xs leading-5 break-words text-muted">{error.message}</p>
      </div>
      <Button onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
