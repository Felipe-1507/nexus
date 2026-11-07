import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@shared/chat';
import { createEventBatcher } from './event-batcher';

const text = (t: string, id = 'm1'): ChatEvent => ({
  type: 'text',
  conversationId: 'c',
  assistantMessageId: id,
  text: t,
});

afterEach(() => vi.useRealTimers());

describe('createEventBatcher', () => {
  it('junta os pedaços de texto e envia depois do intervalo', () => {
    vi.useFakeTimers();
    const sent: ChatEvent[] = [];
    const batcher = createEventBatcher((e) => sent.push(e), 30);
    batcher.push(text('O có'));
    batcher.push(text('digo é '));
    batcher.push(text('4721.'));
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(sent).toEqual([text('O código é 4721.')]);
  });

  it('preserva a ordem: outro evento envia o texto pendente antes', () => {
    vi.useFakeTimers();
    const sent: ChatEvent[] = [];
    const batcher = createEventBatcher((e) => sent.push(e), 30);
    batcher.push(text('Vou ler'));
    batcher.push({ type: 'reset-draft', conversationId: 'c', assistantMessageId: 'm1' });
    batcher.push(text('Pronto'));
    vi.advanceTimersByTime(30);
    expect(sent.map((e) => (e.type === 'text' ? e.text : e.type))).toEqual(['Vou ler', 'reset-draft', 'Pronto']);
  });

  it('não mistura respostas diferentes', () => {
    vi.useFakeTimers();
    const sent: ChatEvent[] = [];
    const batcher = createEventBatcher((e) => sent.push(e), 30);
    batcher.push(text('a', 'm1'));
    batcher.push(text('b', 'm2'));
    vi.advanceTimersByTime(30);
    expect(sent).toEqual([text('a', 'm1'), text('b', 'm2')]);
  });
});
