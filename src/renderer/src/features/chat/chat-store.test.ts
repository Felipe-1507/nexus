import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/chat';
import { useChat } from './chat-store';

const ids = { conversationId: 'c1', assistantMessageId: 'a1' };

beforeEach(() => useChat.setState({ selected: {}, scope: {}, live: {}, pending: {}, unread: {} }));

const request = (id: string, conversationId = 'c1') => ({
  id,
  conversationId,
  workspaceId: 'w1',
  tool: 'Bash',
  title: 'Executar um comando',
  createdAt: '',
});

describe('pedidos de aprovação', () => {
  it('entram e saem conforme os eventos', () => {
    const { apply } = useChat.getState();
    apply({ type: 'permission-request', conversationId: 'c1', request: request('r1') });
    apply({ type: 'permission-request', conversationId: 'c1', request: request('r2') });
    apply({ type: 'permission-resolved', conversationId: 'c1', requestId: 'r1' });
    expect(useChat.getState().pending.c1!.map((r) => r.id)).toEqual(['r2']);
  });

  it('são recompostos a partir da lista do main', () => {
    useChat.getState().loadPending([request('r1', 'c1'), request('r2', 'c2')]);
    expect(Object.keys(useChat.getState().pending)).toEqual(['c1', 'c2']);
  });
});

describe('chat-store', () => {
  it('monta o rascunho, descarta o texto intermediário e registra atividades', () => {
    const { begin, apply } = useChat.getState();
    begin('c1', 'a1');
    apply({ type: 'text', ...ids, text: 'Vou ler ' });
    apply({ type: 'text', ...ids, text: 'o arquivo.' });
    apply({ type: 'reset-draft', ...ids });
    apply({ type: 'activity', ...ids, activity: { kind: 'tool', label: 'Leu nota.md' } });
    apply({ type: 'text', ...ids, text: 'O código é 4721.' });
    expect(useChat.getState().live.c1).toMatchObject({
      assistantMessageId: 'a1',
      draft: 'O código é 4721.',
      activities: [{ kind: 'tool', label: 'Leu nota.md' }],
    });
  });

  it('eventos que chegam antes da resposta do envio não se perdem', () => {
    const { begin, apply } = useChat.getState();
    apply({ type: 'text', ...ids, text: 'rápido' });
    begin('c1', 'a1');
    expect(useChat.getState().live.c1?.draft).toBe('rápido');
  });

  it('fim do turno remove a resposta em andamento', () => {
    const { begin, apply } = useChat.getState();
    begin('c1', 'a1');
    apply({ type: 'turn-end', conversationId: 'c1', message: {} as ChatMessage });
    expect(useChat.getState().live).toEqual({});
  });
});

describe('respostas espontâneas e "resposta nova"', () => {
  const message = (conversationId: string): ChatMessage =>
    ({ id: 'm1', conversationId, role: 'assistant', content: 'ok', status: 'complete' }) as unknown as ChatMessage;

  it('o Claude respondendo sozinho aparece como resposta em andamento e some ao terminar ou ser descartada', () => {
    const { apply } = useChat.getState();
    apply({ type: 'spontaneous-start', conversationId: 'c1', assistantMessageId: 'a9' });
    expect(useChat.getState().live.c1?.assistantMessageId).toBe('a9');
    apply({ type: 'text', conversationId: 'c1', assistantMessageId: 'a9', text: 'Terminou.' });
    expect(useChat.getState().live.c1?.draft).toBe('Terminou.');
    apply({ type: 'turn-discard', conversationId: 'c1' });
    expect(useChat.getState().live.c1).toBeUndefined();
  });

  it('resposta numa conversa que não está aberta fica marcada até o usuário abri-la', () => {
    const { apply, select } = useChat.getState();
    select('w1', 'c2'); // outra conversa aberta
    apply({ type: 'turn-end', conversationId: 'c1', message: message('c1') });
    expect(useChat.getState().unread).toEqual({ c1: true });
    select('w1', 'c1');
    expect(useChat.getState().unread).toEqual({});
  });

  it('resposta na conversa aberta não marca nada', () => {
    const { apply, select } = useChat.getState();
    select('w1', 'c1');
    apply({ type: 'turn-end', conversationId: 'c1', message: message('c1') });
    expect(useChat.getState().unread).toEqual({});
  });
});
