import type { ChatEvent } from '@shared/chat';

type TextEvent = Extract<ChatEvent, { type: 'text' }>;

/**
 * Agrupa pedaços de texto seguidos da mesma resposta e envia no máximo a cada `intervalMs`, para não mandar um
 * evento IPC por token. Qualquer outro evento esvazia o grupo antes, preservando a ordem.
 */
export function createEventBatcher(send: (event: ChatEvent) => void, intervalMs = 30) {
  let pending: TextEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (pending) {
      const event = pending;
      pending = null;
      send(event);
    }
  }

  return {
    push(event: ChatEvent) {
      if (event.type === 'text') {
        if (pending && pending.assistantMessageId === event.assistantMessageId) {
          pending.text += event.text;
          return;
        }
        flush();
        pending = { ...event };
        timer = setTimeout(flush, intervalMs);
        return;
      }
      flush();
      send(event);
    },
    flush,
  };
}
