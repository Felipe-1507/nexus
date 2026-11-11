import { create } from 'zustand';
import type { Activity, Attachment, ChatEvent, QueuedMessage } from '@shared/chat';
import type { PermissionRequest } from '@shared/permissions';

/** Resposta sendo gerada agora: o rascunho visível e o que o Claude já fez. */
export interface LiveTurn {
  assistantMessageId: string;
  draft: string;
  activities: Activity[];
  /** Quando a resposta começou e quando veio o último sinal do Claude (para mostrar que ele não travou). */
  startedAt: number;
  lastEventAt: number;
}

const freshTurn = (assistantMessageId: string): LiveTurn => {
  const now = Date.now();
  return { assistantMessageId, draft: '', activities: [], startedAt: now, lastEventAt: now };
};

type TurnEvent = Extract<ChatEvent, { type: 'text' | 'reset-draft' | 'activity' }>;

interface ChatState {
  /** Conversa aberta em cada Workspace (`null` = conversa nova, ainda não enviada). */
  selected: Record<string, string | null>;
  /** Escopo da barra lateral em cada Workspace: um projeto, ou `null` para as conversas gerais. */
  scope: Record<string, string | null>;
  /** Respostas em andamento, por conversa. */
  live: Record<string, LiveTurn>;
  /** Pedidos de aprovação esperando o usuário, por conversa. */
  pending: Record<string, PermissionRequest[]>;
  /** Texto e anexos que "Editar" devolve ao campo de mensagem (o `nonce` faz repetir a mesma edição funcionar). */
  prefill: Record<string, { text: string; attachments: Attachment[]; nonce: number }>;
  setPrefill: (conversationId: string, value: { text: string; attachments: Attachment[] }) => void;
  /** Mensagens esperando a vez, por conversa, e o último erro ao iniciar uma delas. */
  queue: Record<string, QueuedMessage[]>;
  queueError: Record<string, string>;
  /** Conversas que ganharam resposta enquanto outra estava aberta (bolinha na barra lateral). */
  unread: Record<string, true>;
  select: (workspaceId: string, conversationId: string | null) => void;
  /** Troca o escopo e começa uma conversa nova nele. */
  setScope: (workspaceId: string, projectId: string | null) => void;
  begin: (conversationId: string, assistantMessageId: string) => void;
  /** Recompõe os pedidos pendentes (ex.: depois de recarregar a tela). */
  loadPending: (requests: PermissionRequest[]) => void;
  clearQueueError: (conversationId: string) => void;
  /** Recompõe as filas de mensagens (ex.: depois de recarregar a tela). */
  loadQueues: (queues: Array<{ conversationId: string; items: QueuedMessage[] }>) => void;
  apply: (event: ChatEvent) => void;
}

export const useChat = create<ChatState>()((set) => ({
  selected: {},
  scope: {},
  live: {},
  pending: {},
  queue: {},
  queueError: {},
  unread: {},
  prefill: {},
  setPrefill: (conversationId, value) =>
    set((s) => ({
      prefill: { ...s.prefill, [conversationId]: { ...value, nonce: (s.prefill[conversationId]?.nonce ?? 0) + 1 } },
    })),
  select: (workspaceId, conversationId) =>
    set((s) => {
      const { [conversationId ?? '']: _read, ...unread } = s.unread;
      return { selected: { ...s.selected, [workspaceId]: conversationId }, unread };
    }),
  setScope: (workspaceId, projectId) =>
    set((s) => ({
      scope: { ...s.scope, [workspaceId]: projectId },
      selected: { ...s.selected, [workspaceId]: null },
    })),
  begin: (conversationId, assistantMessageId) =>
    set((s) =>
      // Eventos podem chegar antes da resposta do envio; nesse caso o turno já existe e é mantido.
      s.live[conversationId]?.assistantMessageId === assistantMessageId
        ? s
        : { live: { ...s.live, [conversationId]: freshTurn(assistantMessageId) } },
    ),
  loadPending: (requests) =>
    set(() => {
      const pending: Record<string, PermissionRequest[]> = {};
      for (const r of requests) (pending[r.conversationId] ??= []).push(r);
      return { pending };
    }),
  loadQueues: (queues) =>
    set((s) => {
      const queue = { ...s.queue };
      for (const q of queues) queue[q.conversationId] = q.items;
      return { queue };
    }),
  clearQueueError: (conversationId) =>
    set((s) => {
      const { [conversationId]: _gone, ...rest } = s.queueError;
      return { queueError: rest };
    }),
  apply: (event) =>
    set((s) => {
      const id = event.conversationId;
      switch (event.type) {
        case 'turn-end': {
          const { [id]: _done, ...rest } = s.live;
          // Resposta de uma conversa que não está aberta: fica marcada até o usuário abri-la.
          const open = Object.values(s.selected).includes(id);
          return { live: rest, unread: open ? s.unread : { ...s.unread, [id]: true as const } };
        }
        case 'turn-discard': {
          const { [id]: _done, ...rest } = s.live;
          return { live: rest };
        }
        case 'turn-start':
        case 'spontaneous-start':
          return { live: { ...s.live, [id]: freshTurn(event.assistantMessageId) } };
        case 'queue':
          return {
            queue: { ...s.queue, [id]: event.items },
            queueError: event.error ? { ...s.queueError, [id]: event.error } : s.queueError,
          };
        case 'permission-request':
          return { pending: { ...s.pending, [id]: [...(s.pending[id] ?? []), event.request] } };
        case 'permission-resolved':
          return { pending: { ...s.pending, [id]: (s.pending[id] ?? []).filter((r) => r.id !== event.requestId) } };
        default:
          return { live: { ...s.live, [id]: applyTurnEvent(s.live[id], event) } };
      }
    }),
}));

function applyTurnEvent(current: LiveTurn | undefined, event: TurnEvent): LiveTurn {
  const turn = current?.assistantMessageId === event.assistantMessageId ? current : freshTurn(event.assistantMessageId);
  const next = { ...turn, lastEventAt: Date.now() };
  if (event.type === 'text') return { ...next, draft: turn.draft + event.text };
  if (event.type === 'reset-draft') return { ...next, draft: '' };
  return { ...next, activities: [...turn.activities, event.activity] };
}
