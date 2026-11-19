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

describe('nova tentativa do Claude Code na resposta em andamento', () => {
  const retry = { attempt: 1, maxRetries: 10, delayMs: 2000, status: 529, error: 'overloaded', noResponseMs: null };

  it('guarda o aviso e o tira assim que chega qualquer sinal de resposta', () => {
    useChat.getState().begin('c1', 'm1');
    vi.setSystemTime(1_030_000);
    useChat.getState().apply({ type: 'retry', conversationId: 'c1', assistantMessageId: 'm1', retry });
    expect(useChat.getState().live.c1?.retry).toMatchObject({ attempt: 1, at: 1_030_000 });
    // O aviso conta como sinal: o relógio do "último sinal" reinicia.
    expect(useChat.getState().live.c1?.lastEventAt).toBe(1_030_000);

    vi.setSystemTime(1_040_000);
    useChat.getState().apply({ type: 'text', conversationId: 'c1', assistantMessageId: 'm1', text: 'oi' });
    expect(useChat.getState().live.c1?.retry).toBeUndefined();
    expect(useChat.getState().live.c1?.draft).toBe('oi');
  });
});
