import fs from 'node:fs';
import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { describeTool, TurnAccumulator, type TurnEvent } from './turn-accumulator';

// Fluxos reais do Claude Code (Haiku), gravados por spikes/claude-sdk/capture-fixtures.mjs.
function fixture(name: string): SDKMessage[] {
  const file = path.join(__dirname, '__fixtures__', `${name}.ndjson`);
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as SDKMessage);
}

function replay(name: string, opts: { interrupt?: boolean } = {}) {
  const events: TurnEvent[] = [];
  const messages = fixture(name);
  // O uuid que o Nexus teria enviado: o mesmo que o Claude Code devolveu no result gravado.
  const sent = messages.find((m) => m.type === 'result')?.user_message_uuid;
  const acc = new TurnAccumulator((e) => events.push(e), sent);
  if (opts.interrupt) acc.markInterrupted();
  for (const msg of messages) acc.push(msg);
  return { acc, events, outcome: acc.done };
}

describe('TurnAccumulator com fluxos reais', () => {
  it('resposta simples: texto em streaming e resposta final', () => {
    const { acc, events, outcome } = replay('simples');
    expect(acc.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(outcome).toMatchObject({ status: 'complete', content: 'ok', error: null, activities: [] });
    expect(outcome!.usage!.inputTokens).toBeGreaterThan(0);
  });

  it('texto antes de uma ferramenta vira atividade e só a resposta final fica visível', () => {
    const { events, outcome } = replay('leitura');
    expect(events.map((e) => e.type)).toContain('reset-draft');

    // O que a tela mostra no fim: o rascunho depois do último reset.
    const lastReset = events.map((e) => e.type).lastIndexOf('reset-draft');
    const visible = events
      .slice(lastReset + 1)
      .filter((e): e is Extract<TurnEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.text)
      .join('');
    expect(visible).toBe('O código secreto é 4721.');

    expect(outcome).toMatchObject({ status: 'complete', content: 'O código secreto é 4721.' });
    expect(outcome!.activities).toEqual([
      { kind: 'intermediate', label: 'Vou ler o arquivo.' },
      { kind: 'tool', label: 'Leu nota.md', detail: '<CWD>\\nota.md' },
    ]);
  });

  it('interrupção mantém o que já tinha sido escrito', () => {
    const { outcome } = replay('interrompido', { interrupt: true });
    expect(outcome).toMatchObject({ status: 'interrupted', content: 'um\ndois\ntrês\nquatro', error: null });
  });

  it('o mesmo erro de execução sem pedido de parada é erro', () => {
    const { outcome } = replay('interrompido');
    expect(outcome?.status).toBe('error');
    expect(outcome?.error).toBeTruthy();
  });
});

describe('TurnAccumulator com turnos que o Claude Code inicia sozinho', () => {
  const ours = 'aaaaaaaa-0000-4000-8000-000000000001';
  const result = (extra: Record<string, unknown> = {}) =>
    ({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      usage: { input_tokens: 0, output_tokens: 0 },
      ...extra,
    }) as never;
  const text = (t: string) =>
    ({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
    }) as never;

  it('ignora o fim de um turno sem o nosso uuid (aviso de tarefa em segundo plano) e espera a resposta de verdade', () => {
    const events: TurnEvent[] = [];
    const acc = new TurnAccumulator((e) => events.push(e), ours);
    acc.push(text('As tarefas terminaram. '));
    acc.push(result()); // turno do aviso: sem uuid, sem tokens
    expect(acc.done).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'reset-draft' });

    acc.push(text('Boa ideia.'));
    acc.push(result({ result: 'Boa ideia.', user_message_uuid: ours, user_message_uuids: [ours] }));
    expect(acc.done).toMatchObject({ status: 'complete', content: 'Boa ideia.', activities: [] });
  });

  it('ignora o fim de um turno que respondeu a outra mensagem', () => {
    const acc = new TurnAccumulator(() => {}, ours);
    acc.push(result({ user_message_uuid: 'outra', user_message_uuids: ['outra'] }));
    expect(acc.done).toBeNull();
  });

  it('aceita o fim do turno em que a nossa mensagem foi incorporada junto com outras', () => {
    const acc = new TurnAccumulator(() => {}, ours);
    acc.push(result({ result: 'ok', user_message_uuid: 'ultima', user_message_uuids: ['ultima', ours] }));
    expect(acc.done).toMatchObject({ status: 'complete', content: 'ok' });
  });

  it('um erro sem uuid (falha de partida da sessão) continua aparecendo para o usuário', () => {
    const acc = new TurnAccumulator(() => {}, ours);
    acc.push(result({ subtype: 'error_during_execution', is_error: true, errors: ['No conversation found'] }));
    expect(acc.done).toMatchObject({ status: 'error', error: 'No conversation found' });
  });

  it('descarta atividades e arquivos do turno alheio', () => {
    const acc = new TurnAccumulator(() => {}, ours);
    acc.push({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\a.txt' } }] },
    } as never);
    acc.push(result());
    acc.push(result({ user_message_uuid: ours, user_message_uuids: [ours] }));
    expect(acc.done).toMatchObject({ status: 'complete', activities: [], fileChanges: [] });
  });
});

describe('TurnAccumulator com casos sintéticos', () => {
  it('traduz erros da API para mensagens em pt-BR', () => {
    const acc = new TurnAccumulator(() => {});
    acc.push({ type: 'assistant', error: 'rate_limit', parent_tool_use_id: null, message: { content: [] } } as never);
    acc.push({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'API Error',
      usage: { input_tokens: 0, output_tokens: 0 },
    } as never);
    expect(acc.done).toMatchObject({ status: 'error', error: expect.stringMatching(/limite de uso/) });
  });

  it('ignora mensagens de subagentes', () => {
    const events: TurnEvent[] = [];
    const acc = new TurnAccumulator((e) => events.push(e));
    acc.push({
      type: 'stream_event',
      parent_tool_use_id: 'toolu_x',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'interno' } },
    } as never);
    expect(events).toEqual([]);
  });

  it('marca a ferramenta que falhou', () => {
    const acc = new TurnAccumulator(() => {});
    acc.push({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\x\\a.md' } }] },
    } as never);
    acc.push({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'negado' }],
      },
    } as never);
    expect(acc.fail('processo encerrado').activities).toEqual([
      { kind: 'tool', label: 'Leu a.md', detail: 'C:\\x\\a.md', error: true },
    ]);
  });

  it('falha fora do fluxo durante uma parada pedida conta como interrompida', () => {
    const acc = new TurnAccumulator(() => {});
    acc.markInterrupted();
    expect(acc.fail('processo encerrado')).toMatchObject({ status: 'interrupted', error: null });
  });
});

describe('TurnAccumulator: medição de contexto', () => {
  it('com fluxo real, a primeira e a última chamada vêm do uso de cada passo (quadros repetidos contam uma vez)', () => {
    const { outcome } = replay('leitura');
    expect(outcome?.context).toEqual({
      calls: 2,
      first: { input: 2, cacheCreation: 11_073, cacheRead: 9_450, output: 4 },
      last: { input: 2, cacheCreation: 4_417, cacheRead: 20_523, output: 5 },
    });
    // O contexto da última chamada (24.942) é muito menor que a soma do turno, que o `usage` antigo mostrava.
    expect(outcome!.usage!.inputTokens).toBeGreaterThan(24_942);
  });

  it('a janela e o custo vêm do resultado do turno', () => {
    const { outcome } = replay('leitura');
    expect(outcome?.windowTokens).toBe(1_000_000);
    expect(outcome?.costUsd).toBeCloseTo(0.00385, 5);
  });

  it('um turno sem nenhuma chamada à API não inventa contexto', () => {
    const acc = new TurnAccumulator(() => {});
    acc.push({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-haiku-5-5' } as never);
    acc.push({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0.001,
      modelUsage: { 'claude-haiku-5-5': { contextWindow: 1_000_000 } },
    } as never);
    expect(acc.done?.context).toBeNull();
    expect(acc.done).toMatchObject({ windowTokens: 1_000_000, costUsd: 0.001 });
  });
});

describe('TurnAccumulator: compactação', () => {
  // Fluxo do /compact como o Claude Code o emitiu na verificação com Haiku.
  const compactStream: SDKMessage[] = [
    { type: 'system', subtype: 'init', session_id: 'sess', model: 'claude-haiku-5-5' },
    { type: 'system', subtype: 'status', status: 'compacting' },
    {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 28_960, post_tokens: 2_023, duration_ms: 6_951 },
    },
    {
      type: 'user',
      isSynthetic: true,
      message: {
        role: 'user',
        content:
          'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n1. Objetivo: testar.',
      },
    },
    { type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0.00109,
      modelUsage: { 'claude-haiku-5-5': { contextWindow: 1_000_000 } },
    },
  ] as never;

  it('registra o antes e o depois, o resumo gerado e o custo', () => {
    const acc = new TurnAccumulator(() => {});
    for (const m of compactStream) acc.push(m);
    expect(acc.done).toMatchObject({
      status: 'complete',
      context: null,
      compaction: { trigger: 'manual', preTokens: 28_960, postTokens: 2_023, durationMs: 6_951 },
      costUsd: 0.00109,
    });
    expect(acc.done?.summaryText).toContain('1. Objetivo: testar.');
    expect(acc.done?.summaryText).not.toContain('local-command-stdout');
  });

  it('um turno comum não tem compactação nem resumo', () => {
    const { outcome } = replay('simples');
    expect(outcome?.compaction).toBeNull();
    expect(outcome?.summaryText).toBeNull();
  });
});

describe('describeTool', () => {
  it('descreve as ferramentas em pt-BR', () => {
    expect(describeTool('Grep', { pattern: 'conciliação' }).label).toBe('Buscou "conciliação"');
    expect(describeTool('Bash', { command: 'npm test' })).toEqual({
      kind: 'tool',
      label: 'Executou um comando',
      detail: 'npm test',
    });
    expect(describeTool('mcp__notion__search', {}).label).toBe('Usou search (notion)');
    expect(describeTool('Desconhecida', {}).label).toBe('Usou Desconhecida');
  });
});
