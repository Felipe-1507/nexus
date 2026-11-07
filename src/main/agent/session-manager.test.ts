import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnOutcome } from './turn-accumulator';
import {
  READ_ONLY_DISALLOWED_TOOLS,
  SessionManager,
  type AgentQuery,
  type CreateQuery,
  type SessionConfig,
} from './session-manager';

type Script = (text: string, ctx: { interrupted: () => boolean }) => AsyncGenerator<SDKMessage>;

const init = (sessionId: string) =>
  ({ type: 'system', subtype: 'init', session_id: sessionId }) as unknown as SDKMessage;
const delta = (text: string) =>
  ({
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  }) as unknown as SDKMessage;
const result = (subtype: 'success' | 'error_during_execution', text = '') =>
  ({
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    result: text,
    errors: [],
    usage: { input_tokens: 10, output_tokens: 2 },
  }) as unknown as SDKMessage;

/** Claude Code simulado: para cada mensagem recebida, roda o roteiro e emite as mensagens do SDK. */
function fakeClaude(script: Script, sessionId = '11111111-1111-4111-8111-111111111111') {
  const calls: Options[] = [];
  const queries: Array<{
    closed: boolean;
    interrupt: ReturnType<typeof vi.fn>;
    rewindFiles: ReturnType<typeof vi.fn>;
  }> = [];
  const createQuery: CreateQuery = ({ prompt, options }) => {
    calls.push(options);
    let interrupted = false;
    let closed = false;
    let wake: (() => void) | null = null;
    const state = {
      closed: false,
      rewindFiles: vi.fn(async () => ({ canRewind: true, filesChanged: ['C:\\ws\\a.txt'] })),
      interrupt: vi.fn(async () => {
        interrupted = true;
        wake?.();
      }),
    };
    queries.push(state);
    async function* run(): AsyncGenerator<SDKMessage> {
      for await (const msg of prompt) {
        if (closed) return;
        interrupted = false;
        yield init(sessionId);
        const { uuid, message } = msg as SDKUserMessage;
        const text = message.content as string;
        for await (const out of script(text, { interrupted: () => interrupted })) {
          // Como o Claude Code de verdade: o fim do turno devolve o uuid da mensagem respondida (os roteiros que
          // simulam um turno alheio já trazem a chave e ficam como estão).
          yield out.type === 'result' && !('user_message_uuid' in out)
            ? ({ ...out, user_message_uuid: uuid, user_message_uuids: [uuid] } as SDKMessage)
            : out;
        }
      }
    }
    const gen = run();
    const query: AgentQuery = {
      [Symbol.asyncIterator]: () => gen,
      interrupt: state.interrupt,
      rewindFiles: state.rewindFiles,
      supportedModels: async () => [],
      close: () => {
        closed = true;
        state.closed = true;
        void gen.return(undefined);
      },
    };
    // Permite que o roteiro espere uma interrupção.
    (query as unknown as { waitInterrupt: Promise<void> }).waitInterrupt = new Promise((r) => (wake = r));
    return query;
  };
  return { createQuery, calls, queries };
}

const echo: Script = async function* (text) {
  yield delta('re: ');
  yield delta(text);
  yield result('success', `re: ${text}`);
};

const denyAll: SessionConfig['canUseTool'] = async () => ({ behavior: 'deny', message: 'negado' });

const config: SessionConfig = {
  cliPath: 'C:\\claude.exe',
  cwd: 'C:\\ws',
  resumeSessionId: null,
  systemPromptAppend: 'regras v1',
  mode: 'read_only',
  canUseTool: denyAll,
};

function turn(manager: SessionManager, conversationId: string, text: string, cfg = config) {
  const events: unknown[] = [];
  const sessionIds: string[] = [];
  const done = new Promise<TurnOutcome>((resolve) =>
    manager.startTurn(
      conversationId,
      cfg,
      { uuid: crypto.randomUUID(), text },
      {
        onEvent: (e) => events.push(e),
        onSessionId: (id) => sessionIds.push(id),
        onDone: resolve,
      },
    ),
  );
  return { done, events, sessionIds };
}

afterEach(() => vi.useRealTimers());

describe('SessionManager', () => {
  it('responde em streaming, informa a sessão e reaproveita o processo no turno seguinte', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });

    const first = turn(manager, 'c1', 'oi');
    expect(manager.isRunning('c1')).toBe(true);
    expect(await first.done).toMatchObject({ status: 'complete', content: 're: oi' });
    expect(first.events).toEqual([
      { type: 'text', text: 're: ' },
      { type: 'text', text: 'oi' },
    ]);
    expect(first.sessionIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(manager.isRunning('c1')).toBe(false);

    expect(await turn(manager, 'c1', 'de novo').done).toMatchObject({ content: 're: de novo' });
    expect(fake.calls).toHaveLength(1);
    manager.closeAll();
  });

  it('um turno que o Claude Code inicia sozinho (aviso de tarefa) não é confundido com a resposta', async () => {
    // Retomando uma conversa feita no VS Code, o aviso de uma tarefa em segundo plano chega antes da nossa mensagem:
    // vira um turno próprio, que termina em branco e sem uuid. A resposta de verdade vem depois.
    const script: Script = async function* (text) {
      yield { ...(result('success', '') as object), user_message_uuid: undefined } as unknown as SDKMessage;
      yield delta('re: ');
      yield delta(text);
      yield result('success', `re: ${text}`);
    };
    const fake = fakeClaude(script);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });

    const first = turn(manager, 'c1', 'oi');
    expect(await first.done).toMatchObject({ status: 'complete', content: 're: oi' });
    expect(manager.isRunning('c1')).toBe(false);
  });

  it('resposta que o Claude começa sozinho depois do turno (tarefa em segundo plano terminou) chega à tela', async () => {
    // "Aviso quando terminar": o turno acaba, e minutos depois o Claude Code acorda o Claude, que escreve o resultado.
    const script: Script = async function* (text) {
      yield delta(`vou rodar ${text}`);
      yield result('success', `vou rodar ${text}`);
      yield delta('Terminou: ');
      yield delta('tudo certo.');
      yield result('success', 'Terminou: tudo certo.');
    };
    const manager = new SessionManager({ createQuery: fakeClaude(script).createQuery, env: {} });
    const events: unknown[] = [];
    const spontaneous = new Promise<TurnOutcome>((resolve) =>
      manager.onSpontaneousTurn((conversationId) => {
        events.push({ type: 'start', conversationId });
        return { onEvent: (e) => events.push(e), onSessionId: () => {}, onDone: resolve };
      }),
    );

    const first = await turn(manager, 'c1', 'o teste').done;
    expect(first).toMatchObject({ status: 'complete', content: 'vou rodar o teste' });

    const outcome = await spontaneous;
    expect(outcome).toMatchObject({ status: 'complete', content: 'Terminou: tudo certo.' });
    expect(events).toEqual([
      { type: 'start', conversationId: 'c1' },
      { type: 'text', text: 'Terminou: ' },
      { type: 'text', text: 'tudo certo.' },
    ]);
    expect(manager.isRunning('c1')).toBe(false);
    manager.closeAll();
  });

  it('sem quem trate respostas espontâneas, ou com fim de turno vazio, nada é aberto', async () => {
    const script: Script = async function* () {
      yield result('success', 'ok');
      yield result('success', ''); // fim de turno sem conteúdo
    };
    const manager = new SessionManager({ createQuery: fakeClaude(script).createQuery, env: {} });
    const handler = vi.fn(() => null);
    manager.onSpontaneousTurn(handler);
    await turn(manager, 'c1', 'a').done;
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).not.toHaveBeenCalled(); // só conteúdo de verdade abre uma resposta
    expect(manager.isRunning('c1')).toBe(false);
    manager.closeAll();
  });

  it('enquanto a resposta espontânea escreve, a conversa conta como respondendo e recusa nova mensagem', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const script: Script = async function* () {
      yield result('success', 'ok');
      yield delta('começou');
      await gate;
      yield result('success', 'começou');
    };
    const manager = new SessionManager({ createQuery: fakeClaude(script).createQuery, env: {} });
    const started = new Promise<void>((resolve) =>
      manager.onSpontaneousTurn(() => {
        resolve();
        return { onEvent: () => {}, onSessionId: () => {}, onDone: () => {} };
      }),
    );
    await turn(manager, 'c1', 'a').done;
    await started;
    expect(manager.isRunning('c1')).toBe(true);
    const noop = { onEvent: () => {}, onSessionId: () => {}, onDone: () => {} };
    expect(() => manager.startTurn('c1', config, { uuid: crypto.randomUUID(), text: 'b' }, noop)).toThrow(/Aguarde/);
    release();
    await vi.waitFor(() => expect(manager.isRunning('c1')).toBe(false));
    manager.closeAll();
  });

  it('com tarefa em segundo plano rodando, o processo não é fechado por ociosidade (até acabar)', async () => {
    const task = { task_id: 't1', task_type: 'local_bash', description: 'teste' };
    const script: Script = async function* () {
      yield result('success', 'ok');
      yield { type: 'system', subtype: 'background_tasks_changed', tasks: [task] } as unknown as SDKMessage;
    };
    const fake = fakeClaude(script);
    const manager = new SessionManager({
      createQuery: fake.createQuery,
      env: {},
      idleMs: 30,
      backgroundKeepAliveMs: 5_000,
    });
    await turn(manager, 'c1', 'a').done;
    await new Promise((r) => setTimeout(r, 120)); // bem além da ociosidade de 30 ms
    expect(manager.hasSession('c1')).toBe(true);
    expect(fake.queries[0]!.closed).toBe(false);
    manager.closeAll();
  });

  it('sem tarefas em segundo plano, o processo ocioso fecha; e com tarefa "esquecida" fecha no limite', async () => {
    const task = { task_id: 't1', task_type: 'local_bash', description: 'teste' };
    const idle: Script = async function* () {
      yield result('success', 'ok');
      yield { type: 'system', subtype: 'background_tasks_changed', tasks: [task] } as unknown as SDKMessage;
      yield { type: 'system', subtype: 'background_tasks_changed', tasks: [] } as unknown as SDKMessage;
    };
    const a = new SessionManager({ createQuery: fakeClaude(idle).createQuery, env: {}, idleMs: 30 });
    await turn(a, 'c1', 'a').done;
    await vi.waitFor(() => expect(a.hasSession('c1')).toBe(false));

    const stuck: Script = async function* () {
      yield result('success', 'ok');
      yield { type: 'system', subtype: 'background_tasks_changed', tasks: [task] } as unknown as SDKMessage;
    };
    const b = new SessionManager({
      createQuery: fakeClaude(stuck).createQuery,
      env: {},
      idleMs: 30,
      backgroundKeepAliveMs: 100,
    });
    await turn(b, 'c1', 'a').done;
    await vi.waitFor(() => expect(b.hasSession('c1')).toBe(false), { timeout: 2_000 });
  });

  it('recusa uma segunda mensagem enquanto a primeira está em andamento', async () => {
    const slow: Script = async function* () {
      await new Promise((r) => setTimeout(r, 20));
      yield result('success', 'ok');
    };
    const manager = new SessionManager({ createQuery: fakeClaude(slow).createQuery, env: {} });
    const first = turn(manager, 'c1', 'a');
    const noop = { onEvent: () => {}, onSessionId: () => {}, onDone: () => {} };
    expect(() => manager.startTurn('c1', config, { uuid: crypto.randomUUID(), text: 'b' }, noop)).toThrow(/Aguarde/);
    await first.done;
    manager.closeAll();
  });

  it('configura o Claude Code em somente leitura, sem chave de API e com instruções sempre atuais', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({
      createQuery: fake.createQuery,
      env: { PATH: 'p', ANTHROPIC_API_KEY: 'sk', CLAUDE_CODE_ENTRYPOINT: 'vscode' },
    });
    await turn(manager, 'c1', 'oi').done;
    const options = fake.calls[0]!;
    expect(options.env).toEqual({ PATH: 'p' });
    expect(options.permissionMode).toBe('default');
    expect(options.disallowedTools).toEqual(READ_ONLY_DISALLOWED_TOOLS);
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash', 'PowerShell']));
    expect(options).not.toHaveProperty('tools');
    expect(options.extraArgs).toEqual({ 'system-prompt-snapshot': 'off' });
    expect(options.enableFileCheckpointing).toBe(true);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'regras v1' });
    expect(options.canUseTool).toBe(denyAll);
    manager.closeAll();
  });

  it('repassa modelo e esforço; trocar qualquer um reabre a sessão', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await turn(manager, 'c1', 'a', { ...config, model: 'haiku', effort: 'low' }).done;
    expect(fake.calls[0]).toMatchObject({ model: 'haiku', effort: 'low' });
    await turn(manager, 'c1', 'b', { ...config, model: 'haiku', effort: 'high' }).done;
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]).toMatchObject({ effort: 'high', resume: '11111111-1111-4111-8111-111111111111' });
    manager.closeAll();
  });

  it('modo Auto usa o classificador do Claude Code; Perguntar usa o padrão; nunca bypass', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await turn(manager, 'c1', 'a', { ...config, mode: 'auto' }).done;
    expect(fake.calls[0]).toMatchObject({ permissionMode: 'auto', disallowedTools: undefined });
    await turn(manager, 'c1', 'b', { ...config, mode: 'ask' }).done;
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]).toMatchObject({ permissionMode: 'default', disallowedTools: undefined });
    for (const o of fake.calls) expect(o.permissionMode).not.toBe('bypassPermissions');
    manager.closeAll();
  });

  it('desfaz usando o processo vivo ou reabrindo a sessão', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await turn(manager, 'c1', 'a').done;
    expect(await manager.rewind('c1', config, 'u1', true)).toMatchObject({ canRewind: true });
    expect(fake.queries[0]!.rewindFiles).toHaveBeenCalledWith('u1', { dryRun: true });
    manager.closeAll();

    // Depois de fechado: reabre com resume, sem mandar mensagem.
    const again = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await again.rewind('c1', { ...config, resumeSessionId: '33333333-3333-4333-8333-333333333333' }, 'u1');
    expect(fake.calls.at(-1)!.resume).toBe('33333333-3333-4333-8333-333333333333');
    expect(fake.queries.at(-1)!.rewindFiles).toHaveBeenCalledWith('u1', { dryRun: false });
    again.closeAll();
  });

  it('não desfaz durante uma resposta nem sem sessão conhecida', async () => {
    const manager = new SessionManager({ createQuery: fakeClaude(echo).createQuery, env: {} });
    await expect(manager.rewind('nova', config, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const t = turn(manager, 'c1', 'a');
    await expect(manager.rewind('c1', config, 'u1')).rejects.toMatchObject({ code: 'CONFLICT' });
    await t.done;
    manager.closeAll();
  });

  it('reinicia o processo, continuando a sessão, quando as instruções mudam', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await turn(manager, 'c1', 'a').done;
    await turn(manager, 'c1', 'b', { ...config, systemPromptAppend: 'regras v2' }).done;
    expect(fake.calls).toHaveLength(2);
    expect(fake.queries[0]!.closed).toBe(true);
    expect(fake.calls[1]!.resume).toBe('11111111-1111-4111-8111-111111111111');
    expect(fake.calls[1]!.systemPrompt).toMatchObject({ append: 'regras v2' });
    manager.closeAll();
  });

  it('retoma a sessão salva quando a conversa volta depois de reiniciar o app', async () => {
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    await turn(manager, 'c1', 'a', { ...config, resumeSessionId: '22222222-2222-4222-8222-222222222222' }).done;
    expect(fake.calls[0]!.resume).toBe('22222222-2222-4222-8222-222222222222');
    manager.closeAll();
  });

  it('interromper encerra só o turno', async () => {
    const long: Script = async function* (_text, ctx) {
      yield delta('um ');
      while (!ctx.interrupted()) await new Promise((r) => setTimeout(r, 5));
      yield result('error_during_execution');
    };
    const fake = fakeClaude(long);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    const t = turn(manager, 'c1', 'conte');
    await new Promise((r) => setTimeout(r, 10));
    await manager.interrupt('c1');
    expect(await t.done).toMatchObject({ status: 'interrupted', content: 'um' });
    expect(fake.queries[0]!.closed).toBe(false);
    manager.closeAll();
  });

  it('se o processo morre, o turno vira erro e a próxima mensagem abre outro retomando a sessão', async () => {
    let calls = 0;
    const crashOnce: Script = async function* (text) {
      calls++;
      if (calls === 1) throw new Error('processo encerrado');
      yield result('success', text);
    };
    const fake = fakeClaude(crashOnce);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    expect(await turn(manager, 'c1', 'a').done).toMatchObject({
      status: 'error',
      error: expect.stringContaining('processo encerrado'),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await turn(manager, 'c1', 'b').done).toMatchObject({ status: 'complete' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.resume).toBe('11111111-1111-4111-8111-111111111111');
    manager.closeAll();
  });

  it('fecha processos ociosos', async () => {
    vi.useFakeTimers();
    const fake = fakeClaude(echo);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {}, idleMs: 1000 });
    const t = turn(manager, 'c1', 'a');
    await vi.runAllTimersAsync();
    await t.done;
    expect(fake.queries[0]!.closed).toBe(true);
  });

  it('fechar o app registra a resposta em andamento como interrompida', async () => {
    const forever: Script = async function* () {
      yield delta('parcial');
      await new Promise(() => {});
    };
    const fake = fakeClaude(forever);
    const manager = new SessionManager({ createQuery: fake.createQuery, env: {} });
    const t = turn(manager, 'c1', 'a');
    await new Promise((r) => setTimeout(r, 10));
    manager.closeAll();
    expect(await t.done).toMatchObject({ status: 'interrupted', content: 'parcial' });
    expect(fake.queries[0]!.closed).toBe(true);
  });
});
