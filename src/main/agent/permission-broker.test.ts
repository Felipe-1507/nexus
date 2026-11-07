import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@shared/chat';
import { PermissionBroker } from './permission-broker';

const base = {
  conversationId: 'c1',
  workspaceId: 'w1',
  tool: 'Bash',
  title: 'Executar um comando',
  detail: 'npm test',
};

function setup(timeoutMs = 1000) {
  const events: ChatEvent[] = [];
  let n = 0;
  const broker = new PermissionBroker({ emit: (e) => events.push(e), timeoutMs, newId: () => `r${++n}` });
  return { broker, events };
}

afterEach(() => vi.useRealTimers());

describe('PermissionBroker', () => {
  it('avisa a tela, espera a resposta e avisa que terminou', async () => {
    const { broker, events } = setup();
    const answer = broker.ask(base);
    expect(events[0]).toMatchObject({
      type: 'permission-request',
      conversationId: 'c1',
      request: { id: 'r1', ...base },
    });
    expect(broker.list()).toHaveLength(1);

    broker.respond('r1', 'allow_once');
    expect(await answer).toBe('allow_once');
    expect(events[1]).toEqual({ type: 'permission-resolved', conversationId: 'c1', requestId: 'r1' });
    expect(broker.list()).toEqual([]);
  });

  it('pedido sem resposta expira', async () => {
    vi.useFakeTimers();
    const { broker } = setup(500);
    const answer = broker.ask(base);
    vi.advanceTimersByTime(500);
    expect(await answer).toBe('timeout');
  });

  it('resposta repetida ou atrasada é recusada', async () => {
    const { broker } = setup();
    const answer = broker.ask(base);
    broker.respond('r1', 'deny');
    await answer;
    expect(() => broker.respond('r1', 'allow_once')).toThrow(/já foi respondido/);
  });

  it('parar a conversa cancela só os pedidos dela', async () => {
    const { broker } = setup();
    const a = broker.ask(base);
    const b = broker.ask({ ...base, conversationId: 'c2' });
    broker.cancelConversation('c1');
    expect(await a).toBe('cancel');
    expect(broker.list().map((r) => r.conversationId)).toEqual(['c2']);
    broker.cancelAll();
    expect(await b).toBe('cancel');
  });

  it('sinal de cancelamento do Claude Code encerra o pedido', async () => {
    const { broker } = setup();
    const controller = new AbortController();
    const answer = broker.ask(base, controller.signal);
    controller.abort();
    expect(await answer).toBe('cancel');
    expect(await broker.ask(base, controller.signal)).toBe('cancel');
  });
});
