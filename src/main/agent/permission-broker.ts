import { randomUUID } from 'node:crypto';
import type { ChatEvent } from '@shared/chat';
import { NexusError } from '@shared/ipc-result';
import type { PermissionDecision, PermissionRequest } from '@shared/permissions';

/** Resultado de um pedido: a resposta do usuário, ou o motivo de ele não ter respondido. */
export type BrokerAnswer = PermissionDecision | 'timeout' | 'cancel';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

interface Pending {
  request: PermissionRequest;
  finish: (answer: BrokerAnswer) => void;
}

/**
 * Pedidos de aprovação esperando o usuário. Cada pedido termina de um único jeito: resposta, tempo esgotado,
 * parada da conversa ou app fechando. Tudo que não é uma aprovação explícita vira negação no chamador.
 */
export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly deps: {
      emit: (event: ChatEvent) => void;
      timeoutMs?: number;
      newId?: () => string;
      now?: () => string;
    },
  ) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  ask(input: Omit<PermissionRequest, 'id' | 'createdAt'>, signal?: AbortSignal): Promise<BrokerAnswer> {
    const request: PermissionRequest = { ...input, id: this.newId(), createdAt: this.now() };
    if (signal?.aborted) return Promise.resolve('cancel');
    return new Promise((resolve) => {
      const onAbort = () => finish('cancel');
      const timer = setTimeout(() => finish('timeout'), this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const finish = (answer: BrokerAnswer) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.deps.emit({ type: 'permission-resolved', conversationId: request.conversationId, requestId: request.id });
        resolve(answer);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(request.id, { request, finish });
      this.deps.emit({ type: 'permission-request', conversationId: request.conversationId, request });
    });
  }

  respond(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new NexusError('NOT_FOUND', 'Este pedido já foi respondido ou expirou.');
    pending.finish(decision);
  }

  /** Pedidos ainda sem resposta (para a tela se recompor depois de recarregar). */
  list(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  cancelConversation(conversationId: string): void {
    for (const p of [...this.pending.values()]) {
      if (p.request.conversationId === conversationId) p.finish('cancel');
    }
  }

  cancelAll(): void {
    for (const p of [...this.pending.values()]) p.finish('cancel');
  }
}
