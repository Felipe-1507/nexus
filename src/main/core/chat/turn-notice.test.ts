import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage } from '@shared/chat';
import { turnNotice } from './turn-notice';

const message = (over: Partial<ChatMessage>): ChatMessage =>
  ({
    id: 'm',
    conversationId: 'c',
    role: 'assistant',
    content: '',
    status: 'complete',
    error: null,
    ...over,
  }) as ChatMessage;
const end = (over: Partial<ChatMessage>): ChatEvent => ({
  type: 'turn-end',
  conversationId: 'c',
  message: message(over),
});
const ctx = { projectName: 'NOME', conversationTitle: 'Baixas do dia' };

describe('aviso de resposta pronta', () => {
  it('usa o projeto no título e a primeira linha da resposta, sem marcação', () => {
    const n = turnNotice(end({ content: '\n## **Pronto:** o build passou.\n\nDetalhes…' }), ctx);
    expect(n).toEqual({ title: 'NOME: resposta pronta', body: 'Pronto: o build passou.' });
  });

  it('conversas gerais aparecem como "Geral"; resposta vazia usa o título da conversa', () => {
    expect(turnNotice(end({ content: '' }), { ...ctx, projectName: null })).toEqual({
      title: 'Geral: resposta pronta',
      body: 'Baixas do dia',
    });
  });

  it('avisa erro, mas não interrupção; outros eventos não avisam', () => {
    expect(turnNotice(end({ status: 'error', error: 'Limite atingido' }), ctx)?.title).toBe(
      'NOME: o Claude parou com erro',
    );
    expect(turnNotice(end({ status: 'interrupted' }), ctx)).toBeNull();
    expect(turnNotice({ type: 'turn-discard', conversationId: 'c' }, ctx)).toBeNull();
  });

  it('corta textos longos', () => {
    expect(turnNotice(end({ content: 'x'.repeat(500) }), ctx)!.body).toHaveLength(140);
  });
});
