import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from './chat-store';
import { formatElapsed } from './MessageItem';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  useChat.setState({ live: {}, pending: {} });
});
afterEach(() => vi.useRealTimers());

describe('resposta em andamento', () => {
  it('guarda quando começou e atualiza o último sinal a cada evento', () => {
    useChat.getState().begin('c1', 'm1');
    expect(useChat.getState().live.c1).toMatchObject({ startedAt: 1_000_000, lastEventAt: 1_000_000 });

    vi.setSystemTime(1_007_000);
    useChat.getState().apply({ type: 'text', conversationId: 'c1', assistantMessageId: 'm1', text: 'oi' });
    expect(useChat.getState().live.c1).toMatchObject({ draft: 'oi', startedAt: 1_000_000, lastEventAt: 1_007_000 });

    vi.setSystemTime(1_012_000);
    useChat.getState().apply({
      type: 'activity',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      activity: { kind: 'tool', label: 'Leu a.txt' },
    });
    expect(useChat.getState().live.c1).toMatchObject({ lastEventAt: 1_012_000 });
    expect(useChat.getState().live.c1?.activities).toHaveLength(1);
  });

  it('formata o tempo em segundos e em minutos', () => {
    expect(formatElapsed(7)).toBe('7 s');
    expect(formatElapsed(59)).toBe('59 s');
    expect(formatElapsed(60)).toBe('1 min 00 s');
    expect(formatElapsed(125)).toBe('2 min 05 s');
  });
});
