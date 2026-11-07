import type { RendererError } from '@shared/ipc-contract';
import { invoke } from './ipc';

const MAX_REPORTS = 50;
const reported = new Set<string>();

/** Envia um erro da interface para o log do main. Repetições do mesmo erro são enviadas uma vez só. */
export function reportError(source: RendererError['source'], error: unknown, extra?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.slice(0, 2_000) || err.name;
  const key = `${source}:${message}`;
  if (reported.has(key) || reported.size >= MAX_REPORTS) return;
  reported.add(key);
  const stack = [err.stack, extra].filter(Boolean).join('\n').slice(0, 10_000) || undefined;
  // Se nem o log responder, não há para onde mandar: o erro já está no console do DevTools.
  invoke('app:reportError', { source, message, stack }).catch(() => undefined);
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => reportError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));
}
