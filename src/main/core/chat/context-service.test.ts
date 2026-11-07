import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptTail } from '../../agent/transcript-tail';
import type { TurnContext } from '../../agent/turn-accumulator';
import { ConversationsRepo, type ConversationRow } from '../../persistence/repositories/conversations-repo';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { ProjectService } from '../projects/project-service';
import { WorkspaceService } from '../workspaces/workspace-service';
import { ContextService, type ContextServiceDeps } from './context-service';

let dir: string;
let dbFile: string;
let db: DatabaseSync;
let workspaces: WorkspaceService;
let repo: ConversationsRepo;
let workspaceId: string;
let clock: number;
let running: Set<string>;

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-11-04T12:00:00.000Z');

function open(file: string): DatabaseSync {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA foreign_keys = ON');
  migrate(d, migrations);
  return d;
}

function makeService(extra: Partial<ContextServiceDeps> = {}) {
  return new ContextService({
    db,
    isRunning: (id) => running.has(id),
    now: () => iso(clock),
    home: dir,
    env: {},
    ...extra,
  });
}

function addConversation(over: Partial<ConversationRow> = {}): ConversationRow {
  const id = over.id ?? crypto.randomUUID();
  const row: ConversationRow = {
    id,
    workspaceId,
    projectId: null,
    title: 'Conversa',
    cwd: path.join(dir, 'proj'),
    claudeSessionId: null,
    model: null,
    effort: null,
    createdAt: iso(T0),
    updatedAt: iso(T0),
    ...over,
  };
  repo.insertConversation(row);
  return row;
}

const call = (cacheRead: number, cacheCreation = 0, input = 2) => ({ input, cacheRead, cacheCreation, output: 10 });
const turn = (first: ReturnType<typeof call>, last = first): TurnContext => ({ first, last, calls: 2 });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ctx-'));
  dbFile = path.join(dir, 'nexus.db');
  db = open(dbFile);
  workspaces = new WorkspaceService({ db, dataRoot: dir });
  repo = new ConversationsRepo(db);
  workspaceId = workspaces.create({ name: 'Dev', color: 'violet', icon: 'layers' }).id;
  clock = T0;
  running = new Set();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('medição gravada ao fim de cada turno', () => {
  it('guarda os números da última chamada, e não a soma do turno', () => {
    const c = addConversation();
    makeService().recordTurn({
      conversationId: c.id,
      context: turn(call(20_000, 4_000), call(24_000, 800, 3)),
      model: 'claude-sonnet-5-5',
      compaction: null,
      windowTokens: 1_000_000,
      costUsd: 0.5,
      resumed: true,
      promptHash: 'abc',
    });
    expect(makeService().snapshot(c)).toEqual({
      conversationId: c.id,
      source: 'live',
      model: 'claude-sonnet-5-5',
      contextTokens: 24_803,
      inputTokens: 3,
      cacheReadTokens: 24_000,
      cacheCreationTokens: 800,
      windowTokens: 1_000_000,
      windowSource: 'turn',
      lastCallAt: iso(T0),
      cacheRebuilt: false,
      costUsd: 0.5,
      lastCompaction: null,
    });
  });

  it('cache recriado: a primeira chamada de uma conversa retomada gravou a maior parte do contexto', () => {
    const svc = makeService();
    const rebuilt = addConversation();
    const kept = addConversation();
    const fresh = addConversation();
    const tiny = addConversation();
    const base = { model: 'm', compaction: null, windowTokens: null, costUsd: null, promptHash: null };
    // Medido nas conversas reais: 418 mil gravados de 433 mil.
    svc.recordTurn({ ...base, conversationId: rebuilt.id, context: turn(call(15_485, 418_052)), resumed: true });
    svc.recordTurn({ ...base, conversationId: kept.id, context: turn(call(372_177, 3_345)), resumed: true });
    // Primeira mensagem de uma conversa nova: tudo é gravado, mas não houve "recriação".
    svc.recordTurn({ ...base, conversationId: fresh.id, context: turn(call(0, 30_000)), resumed: false });
    // Contexto pequeno demais para merecer aviso.
    svc.recordTurn({ ...base, conversationId: tiny.id, context: turn(call(0, 9_000)), resumed: true });
    expect(svc.snapshot(rebuilt)?.cacheRebuilt).toBe(true);
    expect(svc.snapshot(kept)?.cacheRebuilt).toBe(false);
    expect(svc.snapshot(fresh)?.cacheRebuilt).toBeNull();
    expect(svc.snapshot(tiny)?.cacheRebuilt).toBe(false);
  });

  it('um turno sem janela informada mantém a janela medida antes', () => {
    const c = addConversation();
    const svc = makeService();
    const base = { model: 'm', compaction: null, costUsd: null, resumed: true, promptHash: null };
    svc.recordTurn({ ...base, conversationId: c.id, context: turn(call(1000)), windowTokens: 1_000_000 });
    svc.recordTurn({ ...base, conversationId: c.id, context: turn(call(2000)), windowTokens: null });
    expect(svc.snapshot(c)).toMatchObject({ contextTokens: 2002, windowTokens: 1_000_000 });
  });

  it('sem chamada e sem compactação, nada é gravado', () => {
    const c = addConversation();
    const svc = makeService();
    svc.recordTurn({
      conversationId: c.id,
      context: null,
      model: null,
      compaction: null,
      windowTokens: null,
      costUsd: null,
      resumed: true,
      promptHash: null,
    });
    expect(svc.snapshot(c)).toBeNull();
  });

  it('a compactação automática de um turno fica registrada junto da medição', () => {
    const c = addConversation();
    const svc = makeService();
    svc.recordTurn({
      conversationId: c.id,
      context: turn(call(20_000)),
      model: 'm',
      compaction: { trigger: 'auto', preTokens: 396_057, postTokens: 20_437, durationMs: 174 },
      windowTokens: null,
      costUsd: null,
      resumed: true,
      promptHash: null,
    });
    expect(svc.snapshot(c)?.lastCompaction).toEqual({
      trigger: 'auto',
      preTokens: 396_057,
      postTokens: 20_437,
      durationMs: 174,
      at: iso(T0),
    });
  });

  it('sobrevive a reiniciar o Nexus: os dados voltam do banco em arquivo', () => {
    const c = addConversation();
    makeService().recordTurn({
      conversationId: c.id,
      context: turn(call(30_000, 500)),
      model: 'claude-sonnet-5-5',
      compaction: null,
      windowTokens: 1_000_000,
      costUsd: 0.1,
      resumed: true,
      promptHash: 'h1',
    });
    makeService().setThresholds({ attention: 40, high: 60, critical: 80 });
    db.close();

    db = open(dbFile); // "reinício"
    const again = makeService();
    expect(again.snapshot(c)).toMatchObject({ contextTokens: 30_502, windowTokens: 1_000_000, source: 'live' });
    expect(again.storedPromptHash(c.id)).toBe('h1');
    expect(again.thresholds()).toEqual({ attention: 40, high: 60, critical: 80 });
  });
});

describe('janela vinda de outra conversa', () => {
  it('usa a janela que outra conversa do mesmo modelo informou, dizendo de onde veio', () => {
    const svc = makeService();
    const a = addConversation();
    const b = addConversation({ claudeSessionId: null });
    const base = { compaction: null, costUsd: null, resumed: true, promptHash: null };
    svc.recordTurn({
      ...base,
      conversationId: a.id,
      context: turn(call(1000)),
      model: 'sonnet-x',
      windowTokens: 777_000,
    });
    svc.recordTurn({ ...base, conversationId: b.id, context: turn(call(1000)), model: 'sonnet-x', windowTokens: null });
    expect(svc.snapshot(b)).toMatchObject({ windowTokens: 777_000, windowSource: 'other-conversation' });
  });

  it('não empresta janela de outro modelo', () => {
    const svc = makeService();
    const a = addConversation();
    const b = addConversation();
    const base = { compaction: null, costUsd: null, resumed: true, promptHash: null };
    svc.recordTurn({
      ...base,
      conversationId: a.id,
      context: turn(call(1000)),
      model: 'haiku-x',
      windowTokens: 1_000_000,
    });
    svc.recordTurn({ ...base, conversationId: b.id, context: turn(call(1000)), model: 'sonnet-x', windowTokens: null });
    expect(svc.snapshot(b)).toMatchObject({ windowTokens: null, windowSource: null });
  });
});

describe('leitura da transcrição (conversas antigas ou usadas fora do Nexus)', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const usage: TranscriptTail = {
    kind: 'usage',
    usage: { model: 'claude-sonnet-5-5', input: 2, cacheRead: 433_537, cacheCreation: 481, at: iso(T0 + 60_000) },
  };

  function withTranscript(mtimeMs: number, tail: TranscriptTail | null | Error) {
    const find = vi.fn(() => ({ file: 'x.jsonl', mtimeMs }));
    const readTail = vi.fn(() => {
      if (tail instanceof Error) throw tail;
      return tail;
    });
    return { find, readTail, svc: makeService({ find, readTail }) };
  }

  it('conversa sem medição ganha uma, marcada como reconstruída, uma única vez', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    const { svc, readTail } = withTranscript(T0 + 60_000, usage);
    const first = await svc.snapshotFresh(c);
    expect(first).toMatchObject({
      source: 'reconstructed',
      model: 'claude-sonnet-5-5',
      contextTokens: 434_020,
      cacheReadTokens: 433_537,
      windowTokens: null,
      cacheRebuilt: null,
      costUsd: null,
      lastCallAt: iso(T0 + 60_000),
    });
    await svc.snapshotFresh(c);
    expect(readTail).toHaveBeenCalledTimes(1);
  });

  it('a janela de outra conversa do mesmo modelo completa o percentual', async () => {
    const other = addConversation();
    makeService().recordTurn({
      conversationId: other.id,
      context: turn(call(1000)),
      model: 'claude-sonnet-5-5',
      compaction: null,
      windowTokens: 1_000_000,
      costUsd: null,
      resumed: true,
      promptHash: null,
    });
    const c = addConversation({ claudeSessionId: sessionId });
    const { svc } = withTranscript(T0, usage);
    expect(await svc.snapshotFresh(c)).toMatchObject({ windowTokens: 1_000_000, windowSource: 'other-conversation' });
  });

  it('se alguém usou a sessão depois (VS Code), a medição é refeita', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    const live = makeService();
    live.recordTurn({
      conversationId: c.id,
      context: turn(call(100_000)),
      model: 'claude-sonnet-5-5',
      compaction: null,
      windowTokens: 1_000_000,
      costUsd: 1,
      resumed: true,
      promptHash: 'h',
    });
    // Arquivo mexido 10 min depois da última medição do Nexus.
    const { svc, readTail } = withTranscript(T0 + 10 * 60_000, usage);
    const after = await svc.snapshotFresh(c);
    expect(readTail).toHaveBeenCalledTimes(1);
    expect(after).toMatchObject({ source: 'reconstructed', contextTokens: 434_020, windowTokens: 1_000_000 });
    expect(svc.storedPromptHash(c.id)).toBeNull(); // o prompt da chamada de fora é desconhecido
  });

  it('dentro da folga depois de um turno do próprio Nexus, não lê a transcrição', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    makeService().recordTurn({
      conversationId: c.id,
      context: turn(call(100_000)),
      model: 'm',
      compaction: null,
      windowTokens: null,
      costUsd: null,
      resumed: true,
      promptHash: null,
    });
    const { svc, readTail } = withTranscript(T0 + 30_000, usage);
    expect(await svc.snapshotFresh(c)).toMatchObject({ source: 'live' });
    expect(readTail).not.toHaveBeenCalled();
  });

  it('durante uma resposta, não mexe na transcrição', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    running.add(c.id);
    const { svc, readTail } = withTranscript(T0 + 60_000, usage);
    expect(await svc.snapshotFresh(c)).toBeNull();
    expect(readTail).not.toHaveBeenCalled();
  });

  it('se a última coisa foi uma compactação, o contexto fica indisponível em vez de repetir um número velho', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    const tail: TranscriptTail = {
      kind: 'after-compaction',
      at: iso(T0 + 1000),
      preTokens: 396_057,
      postTokens: 20_437,
    };
    const { svc } = withTranscript(T0 + 2000, tail);
    expect(await svc.snapshotFresh(c)).toMatchObject({
      source: 'reconstructed',
      contextTokens: null,
      lastCompaction: { preTokens: 396_057, postTokens: 20_437 },
    });
  });

  it('aberturas seguidas e simultâneas compartilham uma só leitura enquanto o arquivo não muda', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    const { svc, readTail } = withTranscript(T0 + 60_000, usage);
    // Dez aberturas ao mesmo tempo (abrir conversas rápido) e mais uma depois: o arquivo é lido uma vez.
    await Promise.all(Array.from({ length: 10 }, () => svc.snapshotFresh(c)));
    await svc.snapshotFresh(c);
    expect(readTail).toHaveBeenCalledTimes(1);
  });

  it('lê de novo quando o arquivo muda (alguém usou a sessão por fora)', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    let mtimeMs = T0 + 60_000;
    const readTail = vi.fn(() => usage);
    const svc = makeService({ find: () => ({ file: 'x.jsonl', mtimeMs }), readTail });
    await svc.snapshotFresh(c);
    mtimeMs = T0 + 10 * 60_000;
    await svc.snapshotFresh(c);
    expect(readTail).toHaveBeenCalledTimes(2);
  });

  it('leitura que falha não fica guardada: a próxima abertura tenta de novo', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    let fail = true;
    const readTail = vi.fn(() => {
      if (fail) throw new Error('EBUSY');
      return usage;
    });
    const svc = makeService({ find: () => ({ file: 'x.jsonl', mtimeMs: T0 + 60_000 }), readTail });
    expect(await svc.snapshotFresh(c)).toBeNull();
    fail = false;
    expect(await svc.snapshotFresh(c)).toMatchObject({ contextTokens: 434_020 });
    expect(readTail).toHaveBeenCalledTimes(2);
  });

  it('disco lento: não prende a abertura, usa a última medição e a leitura termina em segundo plano', async () => {
    vi.useFakeTimers();
    try {
      const c = addConversation({ claudeSessionId: sessionId });
      let release!: (tail: TranscriptTail) => void;
      const readTail = vi.fn(() => new Promise<TranscriptTail>((resolve) => (release = resolve)));
      const svc = makeService({ find: () => ({ file: 'x.jsonl', mtimeMs: T0 + 60_000 }), readTail });
      const pending = svc.snapshotFresh(c);
      await vi.advanceTimersByTimeAsync(4_100);
      expect(await pending).toBeNull(); // nada guardado ainda: a tela segue sem medição, mas responde
      release(usage);
      await vi.advanceTimersByTimeAsync(0);
      // A leitura terminou depois do prazo: a próxima abertura já encontra o resultado, sem ler outra vez.
      expect(await svc.snapshotFresh(c)).toMatchObject({ contextTokens: 434_020 });
      expect(readTail).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sem arquivo, sem uso ou com erro de leitura, fica o que já existia (ou nada)', async () => {
    const c = addConversation({ claudeSessionId: sessionId });
    expect(await makeService({ find: () => null }).snapshotFresh(c)).toBeNull();
    expect(await withTranscript(T0 + 60_000, null).svc.snapshotFresh(c)).toBeNull();
    expect(await withTranscript(T0 + 60_000, new Error('EBUSY')).svc.snapshotFresh(c)).toBeNull();
    expect(await makeService().snapshotFresh(addConversation())).toBeNull(); // sem sessão do Claude Code
  });
});

describe('painel geral', () => {
  it('lista as conversas com projeto (ou Geral), origem da continuação e medição', async () => {
    const folder = fs.mkdtempSync(path.join(dir, 'repo-'));
    const projects = new ProjectService({ db, workspaces });
    const project = await projects.create({
      kind: 'linked',
      workspaceId,
      name: 'NOME',
      path: folder,
      trustConfig: false,
    });
    const inProject = addConversation({ projectId: project.id, title: 'Cadastro' });
    const general = addConversation({ title: 'Visão geral' });
    const fork = addConversation({ projectId: project.id, title: 'Continuação: Cadastro', forkedFrom: inProject.id });
    const svc = makeService();
    svc.recordTurn({
      conversationId: inProject.id,
      context: turn(call(448_000)),
      model: 'claude-sonnet-5-5',
      compaction: null,
      windowTokens: 1_000_000,
      costUsd: null,
      resumed: true,
      promptHash: null,
    });
    running.add(general.id);

    const overview = await svc.overview(workspaceId);
    const by = (id: string) => overview.rows.find((r) => r.conversationId === id)!;
    expect(overview.rows).toHaveLength(3);
    expect(by(inProject.id)).toMatchObject({ projectName: 'NOME', projectId: project.id, forkedFrom: null });
    expect(by(inProject.id).snapshot?.contextTokens).toBe(448_002);
    expect(by(general.id)).toMatchObject({ projectName: null, projectId: null, running: true, snapshot: null });
    expect(by(fork.id)).toMatchObject({ forkedFrom: inProject.id, snapshot: null });
    expect(overview.thresholds).toEqual({ attention: 50, high: 75, critical: 90 });
  });

  it('não lista conversas de outro Workspace nem arquivadas', async () => {
    const other = workspaces.create({ name: 'Outro', color: 'blue', icon: 'layers' });
    addConversation({ workspaceId: other.id, title: 'de fora' });
    const archived = addConversation({ title: 'arquivada' });
    repo.archive(archived.id, iso(T0));
    const kept = addConversation({ title: 'fica' });
    const overview = await makeService().overview(workspaceId);
    expect(overview.rows.map((r) => r.conversationId)).toEqual([kept.id]);
  });
});

describe('compactação registrada', () => {
  it('grava pre_tokens e post_tokens reais e deixa o contexto novo para ser medido na próxima mensagem', () => {
    const source = addConversation();
    const fork = addConversation({ forkedFrom: source.id });
    const svc = makeService({ newId: () => 'comp-1' });
    svc.recordCompaction({
      conversationId: fork.id,
      sourceConversationId: source.id,
      compaction: { trigger: 'manual', preTokens: 448_061, postTokens: 21_000, durationMs: 90_000 },
      model: 'claude-sonnet-5-5',
      windowTokens: 1_000_000,
      costUsd: 0.9,
      promptHash: 'p',
    });
    expect(svc.snapshot(fork)).toMatchObject({
      contextTokens: null,
      windowTokens: 1_000_000,
      costUsd: 0.9,
      lastCompaction: { trigger: 'manual', preTokens: 448_061, postTokens: 21_000, durationMs: 90_000 },
    });
    const rows = db.prepare('SELECT * FROM compactions').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'comp-1',
      conversation_id: fork.id,
      source_conversation_id: source.id,
      pre_tokens: 448_061,
      post_tokens: 21_000,
      cost_usd: 0.9,
    });
  });
});

describe('limites dos avisos', () => {
  it('começam em 50 / 75 / 90, aceitam mudança e recusam ordem inválida', () => {
    const svc = makeService();
    expect(svc.thresholds()).toEqual({ attention: 50, high: 75, critical: 90 });
    expect(svc.setThresholds({ attention: 30, high: 60, critical: 85 })).toEqual({
      attention: 30,
      high: 60,
      critical: 85,
    });
    expect(svc.thresholds()).toEqual({ attention: 30, high: 60, critical: 85 });
    expect(() => svc.setThresholds({ attention: 70, high: 60, critical: 85 })).toThrow(/ordem crescente/);
    expect(svc.thresholds()).toEqual({ attention: 30, high: 60, critical: 85 });
  });
});
