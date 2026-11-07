import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NexusError } from '@shared/ipc-result';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ChatEvent } from '@shared/chat';
import type { ClaudeStatus } from '@shared/claude';
import type { SessionConfig, TurnHandlers } from '../../agent/session-manager';
import type { TurnOutcome } from '../../agent/turn-accumulator';
import { ConversationsRepo } from '../../persistence/repositories/conversations-repo';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import type { TranscriptMessage } from '../../agent/transcript-import';
import { GlobalInstructions } from '../context/global-instructions';
import { KnowledgeService } from '../knowledge/knowledge-service';
import { ProjectService } from '../projects/project-service';
import { WorkspaceService } from '../workspaces/workspace-service';
import {
  ChatService,
  extractSummary,
  titleFrom,
  type ChatServiceDeps,
  type SessionForker,
  type TranscriptSource,
} from './chat-service';

const READY: ClaudeStatus = {
  checkedAt: '',
  cli: { state: 'found', path: 'C:\\claude.exe', version: '2.1.295', source: 'path' },
  auth: { state: 'logged_in', method: null, provider: null, email: null, organization: null, plan: null },
  warnings: [],
  ready: true,
};

/** Gerenciador de sessões simulado: guarda cada turno para o teste conduzir. */
function fakeSessions() {
  const turns: Array<{ conversationId: string; config: SessionConfig; uuid: string; text: string; h: TurnHandlers }> =
    [];
  const running = new Set<string>();
  let spontaneous: ((conversationId: string) => TurnHandlers | null) | null = null;
  return {
    turns,
    onSpontaneousTurn: (fn: (conversationId: string) => TurnHandlers | null) => {
      spontaneous = fn;
    },
    /** Simula o Claude Code começando uma resposta sozinho (ex.: a tarefa em segundo plano terminou). */
    startSpontaneous: (conversationId: string) => {
      const handlers = spontaneous?.(conversationId) ?? null;
      if (handlers) running.add(conversationId);
      return (
        handlers && { ...handlers, onDone: (o: TurnOutcome) => (running.delete(conversationId), handlers.onDone(o)) }
      );
    },
    startTurn: vi.fn(
      (conversationId: string, config: SessionConfig, m: { uuid: string; text: string }, h: TurnHandlers) => {
        running.add(conversationId);
        turns.push({
          conversationId,
          config,
          uuid: m.uuid,
          text: m.text,
          h: { ...h, onDone: (o) => (running.delete(conversationId), h.onDone(o)) },
        });
      },
    ),
    interrupt: vi.fn(async () => {}),
    isRunning: (id: string) => running.has(id),
    hasSession: (id: string) => running.has(id),
    close: vi.fn(),
    rewind: vi.fn(async (_c: string, _cfg: SessionConfig, _uuid: string, dryRun?: boolean) => ({
      canRewind: true,
      filesChanged: dryRun ? ['C:\\ws\\a.txt'] : undefined,
    })),
  };
}

/** Pasta dos anexos nos testes (o serviço real a deriva da pasta do Workspace). */
const ATT_DIR = String.raw`C:\ws\.nexus\anexos`;

const permissions = {
  canUseToolFor: vi.fn(() => async () => ({ behavior: 'deny' as const, message: 'x' })),
  cancelConversation: vi.fn(),
};

let dataRoot: string;
let db: DatabaseSync;
let workspaces: WorkspaceService;
let projects: ProjectService;
let knowledge: KnowledgeService;
let global: GlobalInstructions;
let sessions: ReturnType<typeof fakeSessions>;
let events: ChatEvent[];
let claude: ClaudeStatus;
let chat: ChatService;

/** Conversas que o "Claude Code" já tem gravadas, por pasta (para os testes de importação). */
const transcripts: Record<string, { summary: string; messages: TranscriptMessage[] }> = {};
const transcriptSource: TranscriptSource = {
  list: async () =>
    Object.entries(transcripts).map(([sessionId, t]) => ({ sessionId, summary: t.summary, lastModified: 1 })),
  messages: async (sessionId) => transcripts[sessionId]?.messages ?? [],
};

function makeChat(overrides: Partial<ChatServiceDeps> = {}) {
  return new ChatService({
    db,
    workspaces,
    projects,
    knowledge,
    attachments: { pathOf: (_w, a) => `${ATT_DIR}\\${a.id}.png`, dir: () => ATT_DIR },
    permissions,
    sessions,
    getClaude: async () => claude,
    globalInstructions: () => global.get(),
    transcripts: transcriptSource,
    emit: (e) => events.push(e),
    ...overrides,
  });
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-chat-'));
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, migrations);
  workspaces = new WorkspaceService({ db, dataRoot });
  projects = new ProjectService({ db, workspaces });
  knowledge = new KnowledgeService({ workspaces, emit: () => {} });
  global = new GlobalInstructions(db);
  sessions = fakeSessions();
  events = [];
  claude = READY;
  for (const k of Object.keys(transcripts)) delete transcripts[k];
  chat = makeChat();
});

afterEach(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const base = { color: 'violet', icon: 'layers' } as const;
const outcome = (content: string) => ({
  status: 'complete' as const,
  content,
  error: null,
  activities: [{ kind: 'tool' as const, label: 'Leu nota.md' }],
  usage: { inputTokens: 100, outputTokens: 5 },
  model: 'claude-haiku-5-5',
  fileChanges: [] as Array<{
    path: string;
    kind: 'create' | 'edit';
    before: string | null;
    after: string | null;
    truncated: boolean;
  }>,
});

describe('conversa geral conhece os projetos', () => {
  it('o Geral recebe a lista de projetos do Workspace; a conversa de um projeto, não', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'NOME',
      path: folder,
      trustConfig: false,
    });
    await projects.setInstructions(project.id, '# API de pedidos\nResto das instruções');

    await chat.send({ workspaceId: ws.id, text: 'visão geral' });
    const general = sessions.turns[0]!.config.systemPromptAppend;
    expect(general).toContain('## Projetos deste Workspace');
    expect(general).toContain(`- NOME — pasta: ${folder} — API de pedidos`);

    await chat.send({ workspaceId: ws.id, projectId: project.id, text: 'no projeto' });
    expect(sessions.turns[1]!.config.systemPromptAppend).not.toContain('Projetos deste Workspace');
  });

  it('um projeto novo muda o texto, então a sessão do Geral é reaberta e continua a mesma conversa', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onDone(outcome('ok'));
    const before = sessions.turns[0]!.config.promptKey ?? sessions.turns[0]!.config.systemPromptAppend;
    const folder = fs.mkdtempSync(path.join(dataRoot, 'novo-'));
    await projects.create({ kind: 'linked', workspaceId: ws.id, name: 'Novo', path: folder, trustConfig: false });
    await chat.send({ workspaceId: ws.id, conversationId: first.conversation.id, text: 'de novo' });
    const after = sessions.turns[1]!.config.promptKey ?? sessions.turns[1]!.config.systemPromptAppend;
    expect(after).not.toBe(before);
    expect(after).toContain('Novo');
  });
});

describe('anexos', () => {
  const att = { id: '33333333-3333-4333-8333-333333333333', name: 'tela.png', mime: 'image/png' as const, size: 10 };

  it('a mensagem guarda os anexos e o Claude recebe o caminho de cada um para abrir com o Read', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'o que é isso?', attachments: [att] });
    expect(r.userMessage).toMatchObject({ content: 'o que é isso?', attachments: [att] });
    expect(chat.listMessages(r.conversation.id)[0]).toMatchObject({ attachments: [att] });
    const prompt = sessions.turns[0]!.text;
    expect(prompt.startsWith('o que é isso?')).toBe(true);
    expect(prompt).toContain('ferramenta Read');
    expect(prompt).toContain(`${ATT_DIR}\\${att.id}.png`);
    expect(prompt).toContain('(tela.png)');
  });

  it('só com anexo, sem texto, a conversa se chama pelo arquivo e o pedido é olhar os anexos', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: '', attachments: [att] });
    expect(r.conversation.title).toBe('tela.png');
    expect(sessions.turns[0]!.text).toContain('Veja os arquivos anexados.');
  });

  it('sem anexos, o texto vai exatamente como foi escrito', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    await chat.send({ workspaceId: ws.id, text: 'só texto' });
    expect(sessions.turns[0]!.text).toBe('só texto');
  });

  it('um anexo que sumiu recusa o envio inteiro, sem gravar nada', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    chat = makeChat({
      attachments: {
        pathOf: () => {
          throw new NexusError('NOT_FOUND', 'O anexo "tela.png" não foi encontrado.');
        },
        dir: () => ATT_DIR,
      },
    });
    await expect(chat.send({ workspaceId: ws.id, text: 'oi', attachments: [att] })).rejects.toThrow(
      /não foi encontrado/,
    );
    expect(chat.listConversations(ws.id)).toEqual([]);
  });

  it('a pasta dos anexos entra nas pastas permitidas das conversas de projeto', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'proj-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    await chat.send({ workspaceId: ws.id, projectId: project.id, text: 'oi' });
    expect(sessions.turns[0]!.config.additionalDirectories).toContain(ATT_DIR);
  });

  it('informa os anexos em uso: os de mensagens enviadas e os que esperam na fila', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'oi', attachments: [att] });
    const other = { ...att, id: '44444444-4444-4444-8444-444444444444' };
    chat.enqueue({ workspaceId: ws.id, conversationId: first.conversation.id, text: 'depois', attachments: [other] });
    const inUse = chat.attachmentsInUse(ws.id);
    expect([...inUse.sent]).toEqual([att.id]);
    expect([...inUse.queued]).toEqual([other.id]);
    expect(chat.attachmentsInUse(workspaces.create({ name: 'Outro', ...base }).id)).toEqual({
      sent: new Set(),
      queued: new Set(),
    });
  });

  it('a fila também leva os anexos', async () => {
    const ws = workspaces.create({ name: 'Anexos', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'primeira' });
    const queued = chat.enqueue({
      workspaceId: ws.id,
      conversationId: first.conversation.id,
      text: '',
      attachments: [att],
    });
    expect(queued).toMatchObject([{ text: '', attachments: 1 }]);
    sessions.turns[0]!.h.onDone(outcome('ok'));
    await vi.waitFor(() => expect(sessions.turns).toHaveLength(2));
    expect(sessions.turns[1]!.text).toContain('tela.png');
  });
});

describe('fila de mensagens enquanto o Claude responde', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  async function conversationWithRunningTurn() {
    const ws = workspaces.create({ name: 'Fila', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'primeira' });
    return { ws, conversationId: first.conversation.id };
  }

  it('a mensagem espera a resposta atual e começa sozinha quando ela termina, na ordem certa', async () => {
    const { ws, conversationId } = await conversationWithRunningTurn();
    chat.enqueue({ workspaceId: ws.id, conversationId, text: 'segunda' });
    chat.enqueue({ workspaceId: ws.id, conversationId, text: 'terceira' });
    await flush();

    expect(sessions.turns).toHaveLength(1);
    expect(chat.listMessages(conversationId).map((m) => m.content)).toEqual(['primeira']);
    expect(events.filter((e) => e.type === 'queue').at(-1)).toMatchObject({
      items: [{ text: 'segunda' }, { text: 'terceira' }],
    });

    sessions.turns[0]!.h.onDone(outcome('resposta 1'));
    await vi.waitFor(() => expect(sessions.turns).toHaveLength(2));
    expect(sessions.turns[1]).toMatchObject({ text: 'segunda' });
    expect(events.find((e) => e.type === 'turn-start')).toMatchObject({
      userMessage: { content: 'segunda' },
      conversationId,
    });
    // A terceira ainda espera.
    expect(chat.listMessages(conversationId).map((m) => m.content)).toEqual(['primeira', 'resposta 1', 'segunda']);

    sessions.turns[1]!.h.onDone(outcome('resposta 2'));
    await vi.waitFor(() => expect(sessions.turns).toHaveLength(3));
    expect(sessions.turns[2]).toMatchObject({ text: 'terceira' });
    sessions.turns[2]!.h.onDone(outcome('resposta 3'));
    await flush();
    expect(chat.listMessages(conversationId).map((m) => m.content)).toEqual([
      'primeira',
      'resposta 1',
      'segunda',
      'resposta 2',
      'terceira',
      'resposta 3',
    ]);
    expect(events.filter((e) => e.type === 'queue').at(-1)).toMatchObject({ items: [] });
  });

  it('dá para tirar uma mensagem da fila antes da vez dela', async () => {
    const { ws, conversationId } = await conversationWithRunningTurn();
    const [item] = chat.enqueue({ workspaceId: ws.id, conversationId, text: 'desisti' });
    expect(chat.dequeue(conversationId, item!.id)).toEqual([]);
    sessions.turns[0]!.h.onDone(outcome('ok'));
    await flush();
    expect(sessions.turns).toHaveLength(1);
  });

  it('sem nada respondendo, a mensagem enfileirada começa na hora', async () => {
    const ws = workspaces.create({ name: 'Livre', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onDone(outcome('ok'));
    chat.enqueue({ workspaceId: ws.id, conversationId: first.conversation.id, text: 'outra' });
    await vi.waitFor(() => expect(sessions.turns).toHaveLength(2));
  });

  it('se a mensagem da fila não puder ser enviada, o erro aparece e a fila segue', async () => {
    const { ws, conversationId } = await conversationWithRunningTurn();
    chat.enqueue({ workspaceId: ws.id, conversationId, text: 'vai falhar' });
    chat.enqueue({ workspaceId: ws.id, conversationId, text: 'vai funcionar' });
    claude = { ...READY, ready: false, cli: { state: 'not_found' } };
    sessions.turns[0]!.h.onDone(outcome('ok'));
    await flush();
    expect(events.some((e) => e.type === 'queue' && e.error)).toBe(true);
    claude = READY;
  });

  it('só aceita mensagens de uma conversa do mesmo Workspace', () => {
    const a = workspaces.create({ name: 'A', ...base });
    const b = workspaces.create({ name: 'B', ...base });
    return chat.send({ workspaceId: a.id, text: 'oi' }).then((r) => {
      expect(() => chat.enqueue({ workspaceId: b.id, conversationId: r.conversation.id, text: 'x' })).toThrow(
        /não encontrada/,
      );
    });
  });
});

describe('ChatService', () => {
  it('cria a conversa, grava a mensagem e inicia o turno na pasta do Workspace com as instruções dele', async () => {
    const ws = workspaces.create({ name: 'Trabalho', ...base });
    const { mtimeMs } = workspaces.readInstructions(ws.id);
    workspaces.saveInstructions(ws.id, 'Valores sempre em BRL', mtimeMs);

    const r = await chat.send({ workspaceId: ws.id, text: 'Qual o saldo?\nDetalhes...' });

    expect(r.conversation).toMatchObject({
      workspaceId: ws.id,
      title: 'Qual o saldo?',
      cwd: ws.rootPath,
      running: true,
    });
    expect(r.userMessage).toMatchObject({ role: 'user', content: 'Qual o saldo?\nDetalhes...', seq: 1 });
    const t = sessions.turns[0]!;
    expect(t.uuid).toBe(r.userMessage.id);
    expect(t.config).toMatchObject({ cwd: ws.rootPath, cliPath: 'C:\\claude.exe', resumeSessionId: null });
    expect(t.config.systemPromptAppend).toContain('Workspace "Trabalho"');
    expect(t.config.systemPromptAppend).toContain('Valores sempre em BRL');
  });

  it('repassa os eventos com os ids e grava a resposta no fim', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'oi' });
    const t = sessions.turns[0]!;

    t.h.onEvent({ type: 'text', text: 'Olá' });
    t.h.onSessionId('33333333-3333-4333-8333-333333333333');
    t.h.onDone(outcome('Olá!'));

    expect(events[0]).toEqual({
      type: 'text',
      text: 'Olá',
      conversationId: r.conversation.id,
      assistantMessageId: r.assistantMessageId,
    });
    expect(events[1]).toMatchObject({
      type: 'turn-end',
      message: { id: r.assistantMessageId, role: 'assistant', content: 'Olá!', seq: 2 },
    });
    expect(chat.listMessages(r.conversation.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'oi'],
      ['assistant', 'Olá!'],
    ]);
    expect(chat.listMessages(r.conversation.id)[1]!.activities).toEqual([{ kind: 'tool', label: 'Leu nota.md' }]);
  });

  it('a mensagem seguinte retoma a sessão salva no banco', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onSessionId('33333333-3333-4333-8333-333333333333');
    sessions.turns[0]!.h.onDone(outcome('ok'));

    await chat.send({ workspaceId: ws.id, conversationId: r.conversation.id, text: 'e agora?' });
    expect(sessions.turns[1]!.config.resumeSessionId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('isolamento: não usa conversa de outro Workspace', async () => {
    const a = workspaces.create({ name: 'A', ...base });
    const b = workspaces.create({ name: 'B', ...base });
    const r = await chat.send({ workspaceId: a.id, text: 'segredo de A' });
    sessions.turns[0]!.h.onDone(outcome('ok'));

    await expect(chat.send({ workspaceId: b.id, conversationId: r.conversation.id, text: 'e?' })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    expect(chat.listConversations(b.id)).toEqual([]);
    expect(chat.listConversations(a.id)).toHaveLength(1);
  });

  it('recusa enviar sem Claude Code disponível, sem gravar nada', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    claude = { ...READY, ready: false, auth: { state: 'logged_out' } };
    await expect(chat.send({ workspaceId: ws.id, text: 'oi' })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(chat.listConversations(ws.id)).toEqual([]);
  });

  it('a sessão segue o modo de permissão do Workspace', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    await chat.send({ workspaceId: ws.id, text: 'oi' });
    expect(sessions.turns[0]!.config.mode).toBe('auto');
    expect(sessions.turns[0]!.config.systemPromptAppend).toContain('Você pode criar e editar arquivos');
    expect(permissions.canUseToolFor).toHaveBeenLastCalledWith({
      workspaceId: ws.id,
      conversationId: sessions.turns[0]!.conversationId,
      mode: 'auto',
      roots: [ws.rootPath],
    });
    sessions.turns[0]!.h.onDone(outcome('ok'));

    workspaces.setPermissionMode(ws.id, 'read_only');
    await chat.send({ workspaceId: ws.id, text: 'só ler' });
    expect(sessions.turns[1]!.config.mode).toBe('read_only');
    expect(sessions.turns[1]!.config.systemPromptAppend).toContain('somente leitura');
  });

  it('resposta que o Claude escreve sozinho (tarefa em segundo plano terminou) vira mensagem gravada e avisa a tela', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'rode o teste e avise' });
    sessions.turns[0]!.h.onDone(outcome('Rodando o teste. Aviso quando terminar.'));

    // Minutos depois, o Claude Code acorda o Claude, que escreve o resultado sem nenhuma mensagem do usuário.
    const handlers = sessions.startSpontaneous(first.conversation.id)!;
    expect(handlers).not.toBeNull();
    const start = events.find((e) => e.type === 'spontaneous-start');
    expect(start).toMatchObject({ conversationId: first.conversation.id });
    handlers.onEvent({ type: 'text', text: 'O teste terminou: tudo certo.' });
    expect(events.at(-1)).toMatchObject({ type: 'text', text: 'O teste terminou: tudo certo.' });
    handlers.onDone({ ...outcome('O teste terminou: tudo certo.'), activities: [] });

    const messages = chat.listMessages(first.conversation.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'rode o teste e avise'],
      ['assistant', 'Rodando o teste. Aviso quando terminar.'],
      ['assistant', 'O teste terminou: tudo certo.'],
    ]);
    const end = events.filter((e) => e.type === 'turn-end').at(-1);
    expect(end).toMatchObject({
      conversationId: first.conversation.id,
      message: { content: 'O teste terminou: tudo certo.' },
    });
    // A fila anda e a conversa aceita mensagem de novo.
    await expect(
      chat.send({ workspaceId: ws.id, conversationId: first.conversation.id, text: 'valeu' }),
    ).resolves.toBeTruthy();
  });

  it('resposta espontânea sem nada para mostrar é descartada, sem mensagem vazia', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const first = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onDone(outcome('oi!'));
    const handlers = sessions.startSpontaneous(first.conversation.id)!;
    handlers.onDone({ ...outcome(''), activities: [] });
    expect(chat.listMessages(first.conversation.id)).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'turn-discard', conversationId: first.conversation.id });
  });

  it('modelo: escolha da conversa → padrão do Workspace → padrão do Claude Code', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    // Workspace novo nasce com Sonnet · Médio; limpar a escolha volta ao padrão do Claude Code.
    expect(ws).toMatchObject({ defaultModel: 'sonnet', defaultEffort: 'medium' });
    workspaces.setDefaultModel(ws.id, { model: null, effort: null });
    const herda = await chat.send({ workspaceId: ws.id, text: 'a' });
    expect(sessions.turns[0]!.config).toMatchObject({ model: undefined, effort: undefined });
    expect(herda.conversation).toMatchObject({ model: null, effort: null });
    sessions.turns[0]!.h.onDone(outcome('ok'));

    workspaces.setDefaultModel(ws.id, { model: 'sonnet', effort: 'low' });
    await chat.send({ workspaceId: ws.id, conversationId: herda.conversation.id, text: 'b' });
    expect(sessions.turns[1]!.config).toMatchObject({ model: 'sonnet', effort: 'low' });
    sessions.turns[1]!.h.onDone(outcome('ok'));

    const propria = await chat.send({ workspaceId: ws.id, text: 'c', model: 'haiku', effort: 'max' });
    expect(sessions.turns[2]!.config).toMatchObject({ model: 'haiku', effort: 'max' });
    expect(propria.conversation).toMatchObject({ model: 'haiku', effort: 'max' });
    sessions.turns[2]!.h.onDone(outcome('ok'));

    expect(chat.setModel(propria.conversation.id, { model: 'opus', effort: null })).toMatchObject({
      model: 'opus',
      effort: null,
    });
    await chat.send({ workspaceId: ws.id, conversationId: propria.conversation.id, text: 'd' });
    expect(sessions.turns[3]!.config).toMatchObject({ model: 'opus', effort: 'low' });
  });

  it('guarda o antes e o depois dos arquivos alterados na resposta', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'mude a porta' });
    sessions.turns[0]!.h.onDone({
      ...outcome('Feito.'),
      fileChanges: [
        { path: 'C:\\p\\config.txt', kind: 'edit', before: 'porta=3000', after: 'porta=8080', truncated: false },
      ],
    });
    expect(chat.fileChanges(r.assistantMessageId)).toEqual([
      { path: 'C:\\p\\config.txt', kind: 'edit', before: 'porta=3000', after: 'porta=8080', truncated: false },
    ]);
  });

  it('guarda qual modelo respondeu', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onDone(outcome('ok'));
    expect(chat.listMessages(r.conversation.id).map((m) => m.model)).toEqual([null, 'claude-haiku-5-5']);
  });

  it('parar nega os pedidos de permissão pendentes da conversa', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'oi' });
    await chat.interrupt(r.conversation.id);
    expect(permissions.cancelConversation).toHaveBeenCalledWith(r.conversation.id);
    expect(sessions.interrupt).toHaveBeenCalledWith(r.conversation.id);
  });

  it('desfaz a última resposta que alterou arquivos, a partir da mensagem que a originou', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'crie a.txt' });
    sessions.turns[0]!.h.onDone({
      ...outcome('Criei a.txt.'),
      activities: [{ kind: 'tool', label: 'Criou a.txt', changedFile: 'C:\\ws\\a.txt' }],
    });

    expect(await chat.undo(r.conversation.id, r.assistantMessageId, true)).toEqual({ files: ['C:\\ws\\a.txt'] });
    await chat.undo(r.conversation.id, r.assistantMessageId, false);
    expect(sessions.rewind).toHaveBeenLastCalledWith(r.conversation.id, expect.anything(), r.userMessage.id, false);
    expect(chat.listMessages(r.conversation.id)[1]!.undoneAt).toBeTruthy();
    await expect(chat.undo(r.conversation.id, r.assistantMessageId, false)).rejects.toThrow(/já foram desfeitas/);
  });

  it('não desfaz respostas sem alterações nem respostas antigas', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'a' });
    sessions.turns[0]!.h.onDone({
      ...outcome('ok'),
      activities: [{ kind: 'tool', label: 'Criou a.txt', changedFile: 'C:\\ws\\a.txt' }],
    });
    await expect(chat.undo(r.conversation.id, r.userMessage.id, false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const second = await chat.send({ workspaceId: ws.id, conversationId: r.conversation.id, text: 'b' });
    sessions.turns[1]!.h.onDone(outcome('só li'));
    await expect(chat.undo(r.conversation.id, r.assistantMessageId, false)).rejects.toThrow(/última resposta/);
    await expect(chat.undo(r.conversation.id, second.assistantMessageId, false)).rejects.toThrow(/não alterou/);
  });

  it('conversa de projeto roda na pasta do projeto e consulta as notas do Workspace', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'NOME',
      path: folder,
      trustConfig: false,
    });
    await projects.setInstructions(project.id, 'API em Node e Prisma.');
    global.set('Trabalho com planilhas.');

    const r = await chat.send({ workspaceId: ws.id, projectId: project.id, text: 'status?' });
    const config = sessions.turns[0]!.config;
    const knowledge = path.join(ws.rootPath, 'Conhecimentos');
    expect(r.conversation).toMatchObject({ projectId: project.id, cwd: folder });
    expect(config).toMatchObject({
      cwd: folder,
      additionalDirectories: [knowledge, ATT_DIR],
      settingSources: ['user', 'project', 'local'],
    });
    expect(config.systemPromptAppend).toContain('Trabalho com planilhas.');
    expect(config.systemPromptAppend).toContain('Projeto "NOME"');
    expect(config.systemPromptAppend).toContain('API em Node e Prisma.');
    expect(permissions.canUseToolFor).toHaveBeenLastCalledWith(
      expect.objectContaining({ roots: [folder, knowledge, ATT_DIR] }),
    );

    expect(chat.listConversations(ws.id, project.id)).toHaveLength(1);
    expect(chat.listConversations(ws.id, null)).toHaveLength(0);
  });

  it('o índice de notas vai ao prompt, mas nota nova não reabre a sessão', async () => {
    const ws = workspaces.create({ name: 'Trabalho', ...base });
    knowledge.create(ws.id, '', 'Fechamento Mensal');
    const r = await chat.send({ workspaceId: ws.id, text: 'a' });
    const first = sessions.turns[0]!.config;
    expect(first.systemPromptAppend).toContain('Segundo cérebro');
    expect(first.systemPromptAppend).toContain('- Fechamento Mensal.md — Fechamento Mensal');
    expect(first.systemPromptAppend).toContain('Você é o curador');
    sessions.turns[0]!.h.onDone(outcome('ok'));

    knowledge.create(ws.id, '', 'Conciliação Bancária');
    await chat.send({ workspaceId: ws.id, conversationId: r.conversation.id, text: 'b' });
    const second = sessions.turns[1]!.config;
    expect(second.systemPromptAppend).toContain('Conciliação Bancária');
    expect(second.promptKey).toBe(first.promptKey);

    workspaces.setPermissionMode(ws.id, 'read_only');
    sessions.turns[1]!.h.onDone(outcome('ok'));
    await chat.send({ workspaceId: ws.id, conversationId: r.conversation.id, text: 'c' });
    expect(sessions.turns[2]!.config.systemPromptAppend).not.toContain('Você é o curador');
  });

  it('configurações do projeto não confiadas não são carregadas', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    fs.mkdirSync(path.join(folder, '.claude'));
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{}] } }));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    expect(project.configTrust).toBe('untrusted');

    await chat.send({ workspaceId: ws.id, projectId: project.id, text: 'oi' });
    expect(sessions.turns[0]!.config.settingSources).toEqual(['user']);
  });

  it('pasta do projeto inacessível: recusa sem gravar nada', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    fs.rmSync(folder, { recursive: true });

    await expect(chat.send({ workspaceId: ws.id, projectId: project.id, text: 'oi' })).rejects.toThrow(
      /não encontrada/,
    );
    expect(chat.listConversations(ws.id)).toEqual([]);
    expect(sessions.startTurn).not.toHaveBeenCalled();
  });

  it('isolamento: as instruções e projetos de um Workspace não chegam a outro', async () => {
    const a = workspaces.create({ name: 'A', ...base });
    const b = workspaces.create({ name: 'B', ...base });
    workspaces.saveInstructions(a.id, 'A palavra secreta é GIRASSOL.', workspaces.readInstructions(a.id).mtimeMs);
    const projectA = await projects.create({ kind: 'managed', workspaceId: a.id, name: 'Proj A' });

    await chat.send({ workspaceId: b.id, text: 'qual a palavra secreta?' });
    const prompt = sessions.turns[0]!.config.systemPromptAppend;
    expect(prompt).not.toContain('GIRASSOL');
    expect(prompt).toContain('Workspace "B"');
    expect(sessions.turns[0]!.config.cwd).toBe(b.rootPath);

    await expect(chat.send({ workspaceId: b.id, projectId: projectA.id, text: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('importa uma conversa do Claude Code e continua na mesma sessão', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    transcripts['44444444-4444-4444-8444-444444444444'] = {
      summary: 'Ajustes no relatório',
      messages: [
        { type: 'user', uuid: '55555555-5555-4555-8555-555555555555', message: { content: 'ajuste o relatório' } },
        {
          type: 'assistant',
          uuid: '66666666-6666-4666-8666-666666666666',
          message: { content: [{ type: 'text', text: 'Feito.' }] },
        },
      ],
    };

    expect(await chat.listClaudeSessions(project.id)).toMatchObject([
      { sessionId: '44444444-4444-4444-8444-444444444444', summary: 'Ajustes no relatório', imported: false },
    ]);
    const conv = await chat.importSession(project.id, '44444444-4444-4444-8444-444444444444');
    expect(conv).toMatchObject({ title: 'Ajustes no relatório', projectId: project.id, cwd: folder });
    expect(chat.listMessages(conv.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'ajuste o relatório'],
      ['assistant', 'Feito.'],
    ]);
    expect((await chat.listClaudeSessions(project.id))[0]!.imported).toBe(true);
    await expect(chat.importSession(project.id, '44444444-4444-4444-8444-444444444444')).rejects.toThrow(
      /já foi importada/,
    );

    await chat.send({ workspaceId: ws.id, conversationId: conv.id, text: 'e agora?' });
    expect(sessions.turns[0]!.config.resumeSessionId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('recusa mensagem nova enquanto a anterior responde', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const r = await chat.send({ workspaceId: ws.id, text: 'oi' });
    await expect(
      chat.send({ workspaceId: ws.id, conversationId: r.conversation.id, text: 'mais' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(chat.listMessages(r.conversation.id)).toHaveLength(1);
  });

  it('lista as conversas da mais recente para a mais antiga e arquiva', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    let clock = 0;
    chat = makeChat({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString() });
    const first = await chat.send({ workspaceId: ws.id, text: 'primeira' });
    sessions.turns[0]!.h.onDone(outcome('ok'));
    const second = await chat.send({ workspaceId: ws.id, text: 'segunda' });
    sessions.turns[1]!.h.onDone(outcome('ok'));
    expect(chat.listConversations(ws.id).map((c) => c.id)).toEqual([second.conversation.id, first.conversation.id]);

    chat.archive(first.conversation.id);
    expect(chat.listConversations(ws.id).map((c) => c.id)).toEqual([second.conversation.id]);
  });
});

describe('sincronizar com o Claude Code', () => {
  const SESSION = '77777777-7777-4777-8777-777777777777';
  const tUser = (uuid: string, text: string): TranscriptMessage => ({ type: 'user', uuid, message: { content: text } });
  const tAssistant = (uuid: string, text: string): TranscriptMessage => ({
    type: 'assistant',
    uuid,
    message: { content: [{ type: 'text', text }] },
  });

  async function imported() {
    const ws = workspaces.create({ name: 'Sync', ...base });
    const folder = fs.mkdtempSync(path.join(dataRoot, 'repo-'));
    const project = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    transcripts[SESSION] = {
      summary: 'Conversa do VS Code',
      messages: [tUser('u1', 'primeira'), tAssistant('a1', 'resposta 1')],
    };
    const conv = await chat.importSession(project.id, SESSION);
    return { ws, conv };
  }
  const texts = (id: string) => chat.listMessages(id).map((m) => [m.role, m.content]);
  const updatedAt = (id: string) => db.prepare('SELECT updated_at AS u FROM conversations WHERE id = ?').get(id);

  it('traz o que foi feito fora do Nexus, uma única vez, e atualiza a atividade da conversa', async () => {
    const { conv } = await imported();
    transcripts[SESSION]!.messages.push(tUser('u2', 'feita no VS Code'), tAssistant('a2', 'respondida no VS Code'));
    const before = updatedAt(conv.id);

    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 2 });
    expect(texts(conv.id)).toEqual([
      ['user', 'primeira'],
      ['assistant', 'resposta 1'],
      ['user', 'feita no VS Code'],
      ['assistant', 'respondida no VS Code'],
    ]);
    expect(updatedAt(conv.id)).not.toEqual(before);
    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 0 });
    expect(chat.listMessages(conv.id)).toHaveLength(4);
  });

  it('sem novidade, não mexe em nada (nem na atividade da conversa)', async () => {
    const { conv } = await imported();
    const before = updatedAt(conv.id);
    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 0 });
    expect(updatedAt(conv.id)).toEqual(before);
  });

  it('não duplica o turno feito no próprio Nexus: a pergunta tem o mesmo id e a resposta é reconhecida', async () => {
    const { ws, conv } = await imported();
    const sent = await chat.send({ workspaceId: ws.id, conversationId: conv.id, text: 'feita no Nexus' });
    sessions.turns[0]!.h.onDone(outcome('respondida no Nexus'));
    // O Claude Code grava o mesmo turno na transcrição, e depois alguém continua no VS Code.
    transcripts[SESSION]!.messages.push(
      tUser(sent.userMessage.id, 'feita no Nexus'),
      tAssistant('a-nexus-na-transcricao', 'respondida no Nexus'),
      tUser('u3', 'depois, no VS Code'),
      tAssistant('a3', 'resposta do VS Code'),
    );

    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 2 });
    expect(texts(conv.id)).toEqual([
      ['user', 'primeira'],
      ['assistant', 'resposta 1'],
      ['user', 'feita no Nexus'],
      ['assistant', 'respondida no Nexus'],
      ['user', 'depois, no VS Code'],
      ['assistant', 'resposta do VS Code'],
    ]);
    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 0 });
  });

  it('ignora o resumo e os comandos de compactação gravados como mensagem do usuário', async () => {
    const { conv } = await imported();
    transcripts[SESSION]!.messages.push(
      tUser('s1', 'This session is being continued from a previous conversation that ran out of context.'),
      tUser('s2', '<local-command-stdout>Compacted </local-command-stdout>'),
      tUser('u2', 'pergunta de verdade'),
      tAssistant('a2', 'ok'),
    );
    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 2 });
    expect(texts(conv.id).slice(-2)).toEqual([
      ['user', 'pergunta de verdade'],
      ['assistant', 'ok'],
    ]);
  });

  it('recusa conversa sem sessão, respondendo agora, ou já sendo sincronizada, e não altera nada', async () => {
    const ws = workspaces.create({ name: 'Sem sessão', ...base });
    const fresh = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onDone(outcome('ok')); // terminou, mas o Claude Code nunca informou a sessão
    await expect(chat.syncFromClaudeCode(fresh.conversation.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(chat.listMessages(fresh.conversation.id)).toHaveLength(2);

    // Respondendo agora: espera. Terminada a resposta, sincroniza.
    const { ws: importedWs, conv } = await imported();
    await chat.send({ workspaceId: importedWs.id, conversationId: conv.id, text: 'em andamento' });
    await expect(chat.syncFromClaudeCode(conv.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    sessions.turns.at(-1)!.h.onDone(outcome('pronto'));

    // Duas sincronizações ao mesmo tempo: a segunda é recusada.
    transcripts[SESSION]!.messages.push(tUser('u2', 'nova'), tAssistant('a2', 'nova resposta'));
    const first = chat.syncFromClaudeCode(conv.id);
    await expect(chat.syncFromClaudeCode(conv.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await first).added).toBe(2);
  });

  it('se a transcrição não existe ou não pode ser lida, não inventa nada', async () => {
    const { conv } = await imported();
    delete transcripts[SESSION];
    expect(await chat.syncFromClaudeCode(conv.id)).toEqual({ added: 0 });
    expect(chat.listMessages(conv.id)).toHaveLength(2);
  });
});

describe('extractSummary', () => {
  // Forma real emitida pelo Claude Code (Haiku) para `/compact <instruções>`.
  const real =
    'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n**1. Objetivo do projeto**\nNão há projeto definido.\n\n**6. Próximos passos**\n- Aguardar novas instruções.\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: C:\\Users\\x\\.claude\\projects\\p\\s.jsonl';

  it('fica só o resumo: sem a abertura, o rótulo "Summary:" e a frase final em inglês', () => {
    const text = extractSummary(real)!;
    expect(text.startsWith('**1. Objetivo do projeto**')).toBe(true);
    expect(text.endsWith('- Aguardar novas instruções.')).toBe(true);
    expect(text).not.toMatch(/This session|If you need|Summary:/);
  });

  it('sem resumo reconhecível, não mostra nada', () => {
    expect(extractSummary(null)).toBeNull();
    expect(extractSummary('   ')).toBeNull();
    expect(extractSummary('This session is being continued from a previous conversation.')).toBeNull();
  });
});

describe('titleFrom', () => {
  it('usa a primeira linha e limita o tamanho', () => {
    expect(titleFrom('  Oi\nresto')).toBe('Oi');
    expect(titleFrom('a'.repeat(80))).toHaveLength(60);
    expect(titleFrom('a'.repeat(80)).endsWith('…')).toBe(true);
  });
});

const rowOf = (id: string) => new ConversationsRepo(db).findConversation(id)!;

describe('medidor de contexto no fim de cada turno', () => {
  it('grava a medição do turno antes de avisar a tela', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const sent = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[0]!.h.onSessionId('sess-1');
    sessions.turns[0]!.h.onDone(outcome('ok'));
    let snapshotAtTurnEnd: number | null | undefined;
    chat = makeChat({
      emit: (e) => {
        if (e.type === 'turn-end') snapshotAtTurnEnd = chat.context.snapshot(rowOf(e.conversationId))?.contextTokens;
        events.push(e);
      },
    });
    const second = await chat.send({ workspaceId: ws.id, conversationId: sent.conversation.id, text: 'de novo' });
    sessions.turns[1]!.h.onDone({
      ...outcome('ok'),
      windowTokens: 1_000_000,
      costUsd: 0.02,
      context: {
        calls: 2,
        first: { input: 2, cacheRead: 20_000, cacheCreation: 4_000, output: 5 },
        last: { input: 2, cacheRead: 24_000, cacheCreation: 800, output: 9 },
      },
    });
    expect(snapshotAtTurnEnd).toBe(24_802);
    expect(chat.context.snapshot(rowOf(second.conversation.id))).toMatchObject({
      contextTokens: 24_802,
      windowTokens: 1_000_000,
      cacheRebuilt: false,
      source: 'live',
    });
  });
});

describe('estado do contexto e troca do prompt', () => {
  let workspaceCount = 0;
  async function bigConversation(contextTokens: number) {
    const ws = workspaces.create({ name: `Dev ${++workspaceCount}`, ...base });
    const index = sessions.turns.length;
    const sent = await chat.send({ workspaceId: ws.id, text: 'oi' });
    sessions.turns[index]!.h.onSessionId('sess-1');
    sessions.turns[index]!.h.onDone({
      ...outcome('ok'),
      context: {
        calls: 1,
        first: { input: 2, cacheRead: 0, cacheCreation: contextTokens, output: 5 },
        last: { input: 2, cacheRead: 0, cacheCreation: contextTokens, output: 5 },
      },
    });
    return { ws, id: sent.conversation.id };
  }

  it('avisa que o prompt mudou quando o índice ou as instruções mudaram desde a última chamada (conversa grande e sem processo aberto)', async () => {
    const { ws, id } = await bigConversation(300_000);
    expect((await chat.contextState(id)).promptChanged).toBe(false);
    workspaces.saveInstructions(ws.id, 'Instruções novas do Workspace', workspaces.readInstructions(ws.id).mtimeMs);
    expect((await chat.contextState(id)).promptChanged).toBe(true);
  });

  it('não compara quando a conversa é pequena ou há um processo aberto', async () => {
    const small = await bigConversation(10_000);
    expect((await chat.contextState(small.id)).promptChanged).toBeNull();

    const big = await bigConversation(300_000);
    await chat.send({ workspaceId: big.ws.id, conversationId: big.id, text: 'mais uma' }); // abre o processo (simulado)
    expect(sessions.hasSession(big.id)).toBe(true);
    expect((await chat.contextState(big.id)).promptChanged).toBeNull();
  });

  it('devolve também os limites dos avisos', async () => {
    const { id } = await bigConversation(1000);
    expect((await chat.contextState(id)).thresholds).toEqual({ attention: 50, high: 75, critical: 90 });
  });
});

describe('Continuar em nova conversa', () => {
  const SOURCE_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const FORK_SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const compacted = {
    ...outcome(''),
    content: '',
    activities: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    context: null,
    windowTokens: 1_000_000,
    costUsd: 0.9,
    compaction: { trigger: 'manual' as const, preTokens: 448_061, postTokens: 21_000, durationMs: 90_000 },
    summaryText:
      'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n1. Objetivo do projeto: cadastro fiscal.\n2. Alterações: novo filtro.\n\nPlease continue the conversation from where we left it off without asking the user any further questions.',
  };

  let forker: { fork: Mock<SessionForker['fork']>; remove: Mock<SessionForker['remove']> };
  let clock: number;

  async function source() {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const sent = await chat.send({ workspaceId: ws.id, text: 'Cadastro fiscal' });
    sessions.turns[0]!.h.onSessionId(SOURCE_SESSION);
    sessions.turns[0]!.h.onDone(outcome('pronto'));
    return { ws, id: sent.conversation.id };
  }

  /** Responde ao `/compact` que o serviço mandou para a cópia. */
  function finishCompaction(index: number, result: Record<string, unknown> = {}) {
    const turn = sessions.turns[index]!;
    turn.h.onSessionId(FORK_SESSION);
    turn.h.onDone({ ...compacted, ...result });
  }

  const row = (id: string) =>
    db
      .prepare(
        'SELECT id, claude_session_id AS session, updated_at AS updatedAt, forked_from AS forkedFrom FROM conversations WHERE id = ?',
      )
      .get(id) as { id: string; session: string | null; updatedAt: string; forkedFrom: string | null };
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n;
  const messageCount = (id: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(id) as { n: number }).n;

  beforeEach(() => {
    clock = Date.parse('2026-11-04T12:00:00.000Z');
    forker = {
      fork: vi.fn(async () => FORK_SESSION),
      remove: vi.fn(async () => undefined),
    };
    chat = makeChat({ forker, now: () => new Date((clock += 1000)).toISOString() });
  });

  it('copia a sessão, compacta só a cópia e cria a conversa nova sem tocar na original', async () => {
    const { id } = await source();
    const before = row(id);
    const beforeMessages = messageCount(id);
    const startedBefore = sessions.startTurn.mock.calls.length;

    const pending = chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(startedBefore + 1));
    const turn = sessions.turns[startedBefore]!;
    // A compactação roda numa conversa NOVA e retoma a CÓPIA, nunca a sessão original.
    expect(turn.conversationId).not.toBe(id);
    expect(turn.config.resumeSessionId).toBe(FORK_SESSION);
    expect(turn.config.resumeSessionId).not.toBe(SOURCE_SESSION);
    expect(turn.text.startsWith('/compact ')).toBe(true);
    expect(turn.text).toContain('Objetivo do projeto');
    expect(turn.text).toContain('Próximos passos');
    finishCompaction(startedBefore);
    const result = await pending;

    expect(forker.fork).toHaveBeenCalledTimes(1);
    expect(forker.fork.mock.calls[0]![0]).toBe(SOURCE_SESSION);
    expect(forker.remove).not.toHaveBeenCalled();
    expect(result.alreadyExisted).toBe(false);
    expect(result.summaryShown).toBe(true);
    expect(result.compaction).toEqual({ preTokens: 448_061, postTokens: 21_000, durationMs: 90_000, costUsd: 0.9 });
    expect(result.conversation).toMatchObject({ title: 'Continuação: Cadastro fiscal', forkedFrom: id });
    expect(row(result.conversation.id)).toMatchObject({ session: FORK_SESSION, forkedFrom: id });

    // A conversa original: mesma sessão, mesma atividade, nenhuma mensagem nova.
    expect(row(id)).toEqual(before);
    expect(messageCount(id)).toBe(beforeMessages);
    expect(chat.listConversations(result.conversation.workspaceId).map((c) => c.id)).toContain(id);

    // A primeira mensagem da conversa nova mostra o antes e o depois e o resumo, sem a moldura em inglês.
    const first = chat.listMessages(result.conversation.id)[0]!;
    expect(first.role).toBe('assistant');
    expect(first.content).toContain('448.061 → 21.000');
    expect(first.content).toContain('Desfazer');
    expect(first.content).toContain('1. Objetivo do projeto: cadastro fiscal.');
    expect(first.content).not.toContain('This session is being continued');
    expect(first.content).not.toContain('Please continue');

    expect(chat.context.snapshot(rowOf(result.conversation.id))).toMatchObject({
      contextTokens: null,
      windowTokens: 1_000_000,
      lastCompaction: { trigger: 'manual', preTokens: 448_061, postTokens: 21_000 },
    });
  });

  it('sem o resumo estruturado, usa o /compact puro e não mostra resumo', async () => {
    const { id } = await source();
    const started = sessions.startTurn.mock.calls.length;
    const pending = chat.continueInNewConversation({ conversationId: id, structuredSummary: false });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    expect(sessions.turns[started]!.text).toBe('/compact');
    finishCompaction(started);
    const result = await pending;
    expect(result.summaryShown).toBe(false);
    expect(chat.listMessages(result.conversation.id)[0]!.content).not.toContain('Objetivo do projeto');
  });

  it('a conversa nova continua a partir da cópia compactada', async () => {
    const { ws, id } = await source();
    const started = sessions.startTurn.mock.calls.length;
    const pending = chat.continueInNewConversation({ conversationId: id, structuredSummary: false });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    finishCompaction(started);
    const { conversation } = await pending;
    await chat.send({ workspaceId: ws.id, conversationId: conversation.id, text: 'seguimos' });
    const turn = sessions.turns.at(-1)!;
    expect(turn.conversationId).toBe(conversation.id);
    expect(turn.config.resumeSessionId).toBe(FORK_SESSION);
  });

  it('se a cópia falhar, nada é criado e nada é apagado', async () => {
    const { id } = await source();
    forker.fork.mockRejectedValueOnce(new Error('disco cheio'));
    const conversations = count();
    const started = sessions.startTurn.mock.calls.length;
    await expect(chat.continueInNewConversation({ conversationId: id, structuredSummary: true })).rejects.toThrow(
      /disco cheio/,
    );
    expect(count()).toBe(conversations);
    expect(sessions.startTurn.mock.calls.length).toBe(started);
    expect(forker.remove).not.toHaveBeenCalled();
  });

  it('se a compactação falhar, interrompe: apaga só a cópia, não cria conversa e permite tentar de novo', async () => {
    const { id } = await source();
    const conversations = count();
    const started = sessions.startTurn.mock.calls.length;
    const first = chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    finishCompaction(started, { status: 'error', error: 'O Claude está sobrecarregado no momento.', compaction: null });
    await expect(first).rejects.toThrow(/sobrecarregado/);

    expect(count()).toBe(conversations);
    expect(forker.remove).toHaveBeenCalledTimes(1);
    expect(forker.remove.mock.calls[0]![0]).toBe(FORK_SESSION);
    expect(forker.remove.mock.calls[0]![0]).not.toBe(SOURCE_SESSION);
    expect(sessions.close).toHaveBeenCalled();
    expect(row(id).session).toBe(SOURCE_SESSION);

    // O pedido não ficou preso: uma nova tentativa funciona e cria uma única conversa.
    const second = chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 2));
    finishCompaction(started + 1);
    await second;
    expect(count()).toBe(conversations + 1);
  });

  it('um turno que terminou sem compactar (nada a compactar) também é falha', async () => {
    const { id } = await source();
    const conversations = count();
    const started = sessions.startTurn.mock.calls.length;
    const pending = chat.continueInNewConversation({ conversationId: id, structuredSummary: false });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    finishCompaction(started, { compaction: null, content: 'Not enough messages to compact.' });
    await expect(pending).rejects.toThrow(/Not enough messages/);
    expect(count()).toBe(conversations);
    expect(forker.remove).toHaveBeenCalledTimes(1);
  });

  it('repetir o pedido depois do sucesso devolve a mesma continuação, sem copiar de novo', async () => {
    const { id } = await source();
    const started = sessions.startTurn.mock.calls.length;
    const pending = chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    finishCompaction(started);
    const first = await pending;
    const conversations = count();

    const again = await chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    expect(again.alreadyExisted).toBe(true);
    expect(again.conversation.id).toBe(first.conversation.id);
    expect(count()).toBe(conversations);
    expect(forker.fork).toHaveBeenCalledTimes(1);
    expect((await chat.continuationPreview(id)).existing?.id).toBe(first.conversation.id);
  });

  it('dois pedidos ao mesmo tempo: o segundo é recusado', async () => {
    const { id } = await source();
    const started = sessions.startTurn.mock.calls.length;
    const first = chat.continueInNewConversation({ conversationId: id, structuredSummary: true });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    await expect(chat.continueInNewConversation({ conversationId: id, structuredSummary: true })).rejects.toThrow(
      /em andamento/,
    );
    finishCompaction(started);
    await first;
    expect(forker.fork).toHaveBeenCalledTimes(1);
  });

  it('depois de novas mensagens na original, uma nova continuação é permitida', async () => {
    const { ws, id } = await source();
    const started = sessions.startTurn.mock.calls.length;
    const first = chat.continueInNewConversation({ conversationId: id, structuredSummary: false });
    await vi.waitFor(() => expect(sessions.startTurn.mock.calls.length).toBe(started + 1));
    finishCompaction(started);
    await first;

    await chat.send({ workspaceId: ws.id, conversationId: id, text: 'mais um pedido na original' });
    sessions.turns.at(-1)!.h.onDone(outcome('feito'));
    expect((await chat.continuationPreview(id)).existing).toBeNull();
  });

  it('recusa conversa respondendo, com fila, sem histórico no Claude Code ou sem a cópia disponível', async () => {
    const ws = workspaces.create({ name: 'Outro', ...base });
    const running = await chat.send({ workspaceId: ws.id, text: 'ainda respondendo' });
    await expect(
      chat.continueInNewConversation({ conversationId: running.conversation.id, structuredSummary: true }),
    ).rejects.toThrow(/Aguarde/);
    sessions.turns[0]!.h.onDone(outcome('ok')); // terminou, mas o Claude Code nunca informou a sessão
    await expect(
      chat.continueInNewConversation({ conversationId: running.conversation.id, structuredSummary: true }),
    ).rejects.toThrow(/ainda não tem histórico/);

    const { id } = await source();
    chat = makeChat();
    await expect(chat.continueInNewConversation({ conversationId: id, structuredSummary: true })).rejects.toThrow(
      /cópia de sessões/,
    );
    expect(forker.fork).not.toHaveBeenCalled();
  });
});
