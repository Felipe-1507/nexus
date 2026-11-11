import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Attachment, ChatEvent, ChatMessage, SendMessageInput } from '@shared/chat';
import type { PermissionDecision, QuestionAnswers } from '@shared/permissions';
import { invoke } from '@renderer/lib/ipc';
import { refreshUsage } from '@renderer/features/claude/usage';
import { useChat } from './chat-store';

export const chatKeys = {
  /** Sem `scope`, serve de prefixo para invalidar todas as listas do Workspace. */
  conversations: (workspaceId: string, scope?: string | null) =>
    scope === undefined
      ? (['conversations', workspaceId] as const)
      : (['conversations', workspaceId, scope ?? 'geral'] as const),
  messages: (conversationId: string) => ['messages', conversationId] as const,
};

/** Conversas do escopo: `null` = gerais do Workspace; um id = as do projeto. */
/**
 * Troca o escopo (um projeto, ou o "Geral" com `null`) e já abre a conversa mais recente dele, em vez de uma conversa
 * nova em branco. Sem nenhuma conversa ainda, fica a tela de conversa nova.
 */
export function useOpenScope() {
  const queryClient = useQueryClient();
  return async (workspaceId: string, projectId: string | null): Promise<void> => {
    useChat.getState().setScope(workspaceId, projectId);
    try {
      const list = await queryClient.fetchQuery({
        queryKey: chatKeys.conversations(workspaceId, projectId),
        queryFn: () => invoke('conversations:list', { workspaceId, projectId }),
        staleTime: 0,
      });
      const state = useChat.getState();
      // Só abre se o usuário ainda está nesse escopo e não escolheu outra conversa nesse meio-tempo.
      if ((state.scope[workspaceId] ?? null) === projectId && state.selected[workspaceId] == null && list[0]) {
        state.select(workspaceId, list[0].id);
      }
    } catch {
      // Sem a lista, o escopo já está trocado e a conversa nova continua disponível.
    }
  };
}

export function useConversations(workspaceId: string | undefined, projectId: string | null) {
  return useQuery({
    queryKey: chatKeys.conversations(workspaceId ?? '', projectId),
    queryFn: () => invoke('conversations:list', { workspaceId: workspaceId!, projectId }),
    enabled: Boolean(workspaceId),
  });
}

export function useMessages(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? ''),
    queryFn: () => invoke('conversations:messages', { conversationId: conversationId! }),
    enabled: Boolean(conversationId),
  });
}

function appendMessage(old: ChatMessage[] | undefined, message: ChatMessage): ChatMessage[] {
  if (!old) return [message];
  return old.some((m) => m.id === message.id) ? old : [...old, message];
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput) => invoke('chat:send', input),
    onSuccess: (r) => {
      useChat.getState().begin(r.conversation.id, r.assistantMessageId);
      useChat.getState().select(r.conversation.workspaceId, r.conversation.id);
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(r.conversation.id), (old) =>
        appendMessage(old, r.userMessage),
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations(r.conversation.workspaceId) });
    },
  });
}

export function useEnqueueMessage() {
  return useMutation({
    mutationFn: (input: { workspaceId: string; conversationId: string; text: string; attachments?: Attachment[] }) =>
      invoke('chat:enqueue', input),
  });
}

export function useDequeueMessage() {
  return useMutation({
    mutationFn: (input: { conversationId: string; id: string }) => invoke('chat:dequeue', input),
  });
}

export function useInterrupt() {
  return useMutation({ mutationFn: (conversationId: string) => invoke('chat:interrupt', { conversationId }) });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; title: string }) => invoke('conversations:rename', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => invoke('conversations:archive', { conversationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useRespondPermission() {
  return useMutation({
    mutationFn: (input: { requestId: string; decision: PermissionDecision; answers?: QuestionAnswers }) =>
      invoke('permissions:respond', input),
  });
}

export function useUndo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; messageId: string; dryRun: boolean }) => invoke('chat:undo', input),
    onSuccess: (_r, input) => {
      if (!input.dryRun) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(input.conversationId) });
    },
  });
}

/** Escuta os eventos das respostas (uma vez, no topo do app). */
export function useChatEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = window.nexus.on('chat:event', (payload) => {
      const event = payload as ChatEvent;
      useChat.getState().apply(event);
      if (event.type === 'turn-start') {
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(event.conversationId), (old) =>
          appendMessage(old, event.userMessage),
        );
      }
      if (event.type === 'turn-end') {
        // Uma resposta gasta cota: o medidor do plano lê de novo.
        void refreshUsage(queryClient);
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(event.conversationId), (old) =>
          appendMessage(old, event.message),
        );
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        // A medição do contexto foi gravada antes deste evento: a faixa e o painel de sessões leem de novo.
        void queryClient.invalidateQueries({ queryKey: ['context'] });
      }
    });
    // Pedidos feitos antes desta tela existir (ex.: depois de recarregar) também aparecem.
    invoke('permissions:pending')
      .then((requests) => useChat.getState().loadPending(requests))
      .catch(() => undefined);
    invoke('chat:queues')
      .then((queues) => useChat.getState().loadQueues(queues))
      .catch(() => undefined);
    return unsubscribe;
  }, [queryClient]);
}
