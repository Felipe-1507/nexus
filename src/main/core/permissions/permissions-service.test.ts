import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@shared/chat';
import type { PermissionRequest } from '@shared/permissions';
import { PermissionBroker } from '../../agent/permission-broker';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { WorkspaceService } from '../workspaces/workspace-service';
import { PermissionsService, type PermissionScope } from './permissions-service';

let dataRoot: string;
let db: DatabaseSync;
let events: ChatEvent[];
let service: PermissionsService;
let scope: PermissionScope;

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-perm-'));
  db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  const ws = new WorkspaceService({ db, dataRoot }).create({ name: 'A', color: 'violet', icon: 'layers' });
  events = [];
  service = new PermissionsService(db, new PermissionBroker({ emit: (e) => events.push(e) }));
  scope = { workspaceId: ws.id, conversationId: 'c1', mode: 'ask', roots: [ws.rootPath] };
});

afterEach(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const opts = () => ({ signal: new AbortController().signal, toolUseID: 't' }) as never;

/** Responde o próximo pedido assim que ele aparecer. */
async function answerNext(decision: 'allow_once' | 'allow_always' | 'deny'): Promise<PermissionRequest> {
  for (let i = 0; i < 50; i++) {
    const req = service.pending()[0];
    if (req) {
      service.respond(req.id, decision);
      return req;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('nenhum pedido apareceu');
}

describe('perguntas do Claude (AskUserQuestion)', () => {
  const input = {
    questions: [
      {
        question: 'Qual pasta usar?',
        header: 'Pasta',
        multiSelect: false,
        options: [
          { label: 'img', description: 'a pasta atual' },
          { label: 'assets', description: 'a nova' },
        ],
      },
    ],
  };

  it('mostra as opções, devolve a resposta ao Claude e não entra na auditoria', async () => {
    const canUse = service.canUseToolFor({ ...scope, mode: 'read_only' });
    const result = canUse('AskUserQuestion', input, opts());
    for (let i = 0; i < 50 && !service.pending()[0]; i++) await new Promise((r) => setTimeout(r, 1));
    const req = service.pending()[0]!;
    expect(req.questions?.[0]?.options).toHaveLength(2);
    service.respond(req.id, 'allow_once', { 'Qual pasta usar?': 'assets' });
    expect(await result).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers: { 'Qual pasta usar?': 'assets' } },
    });
    expect(service.listAudit(scope.workspaceId)).toEqual([]);
  });

  it('dispensar devolve uma negação que orienta o Claude a seguir com uma suposição', async () => {
    const canUse = service.canUseToolFor(scope);
    const result = canUse('AskUserQuestion', input, opts());
    await answerNext('deny');
    expect(await result).toMatchObject({ behavior: 'deny', message: expect.stringContaining('dispensou') });
  });

  it('recusa perguntas em formato inválido sem incomodar o usuário', async () => {
    const result = await service.canUseToolFor(scope)('AskUserQuestion', { questions: 'oi' }, opts());
    expect(result).toMatchObject({ behavior: 'deny' });
    expect(service.pending()).toEqual([]);
  });
});

describe('PermissionsService', () => {
  it('libera leitura dentro do Workspace sem perguntar nem registrar', async () => {
    const canUse = service.canUseToolFor(scope);
    const r = await canUse('Read', { file_path: path.join(scope.roots[0]!, 'a.md') }, opts());
    expect(r!.behavior).toBe('allow');
    expect(events).toEqual([]);
    expect(service.listAudit(scope.workspaceId)).toEqual([]);
  });

  it('pergunta, registra a decisão e cria a regra com "sempre permitir"', async () => {
    const canUse = service.canUseToolFor(scope);
    const first = canUse('Bash', { command: 'npm test' }, opts());
    const req = await answerNext('allow_always');
    expect(req).toMatchObject({
      title: 'Executar um comando',
      detail: 'npm test',
      alwaysLabel: 'Sempre permitir "npm test" neste Workspace',
    });
    expect((await first)!.behavior).toBe('allow');

    // A mesma família de comando agora passa pela regra, sem perguntar.
    expect((await canUse('Bash', { command: 'npm test -- --run' }, opts()))!.behavior).toBe('allow');
    expect(service.pending()).toEqual([]);
    expect(service.listRules(scope.workspaceId)).toMatchObject([
      { tool: 'Bash', pattern: 'npm test', label: 'Comandos que começam com "npm test"' },
    ]);
    expect(service.listAudit(scope.workspaceId).map((a) => [a.decision, a.decidedBy])).toEqual([
      ['allow', 'rule'],
      ['allow', 'user'],
    ]);
  });

  it('negação vira resposta ao Claude e fica registrada', async () => {
    const canUse = service.canUseToolFor(scope);
    const pending = canUse('Write', { file_path: path.join(scope.roots[0]!, 'b.txt') }, opts());
    await answerNext('deny');
    const r = await pending;
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/negou/) });
    expect(service.listAudit(scope.workspaceId)[0]).toMatchObject({
      tool: 'Write',
      summary: 'Criar b.txt',
      decision: 'deny',
      decidedBy: 'user',
    });
  });

  it('parar a conversa nega e interrompe', async () => {
    const canUse = service.canUseToolFor(scope);
    const pending = canUse('Bash', { command: 'rm x' }, opts());
    await new Promise((r) => setTimeout(r, 5));
    service.cancelConversation('c1');
    expect(await pending).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(service.listAudit(scope.workspaceId)[0]).toMatchObject({ decidedBy: 'cancel' });
  });

  it('modo somente leitura nega edição sem perguntar', async () => {
    const canUse = service.canUseToolFor({ ...scope, mode: 'read_only' });
    const r = await canUse('Edit', { file_path: path.join(scope.roots[0]!, 'a.md') }, opts());
    expect(r!.behavior).toBe('deny');
    expect(events).toEqual([]);
  });

  it('remove regras', async () => {
    const canUse = service.canUseToolFor(scope);
    const p = canUse('WebFetch', { url: 'https://x' }, opts());
    await answerNext('allow_always');
    await p;
    const [rule] = service.listRules(scope.workspaceId);
    service.removeRule(rule!.id);
    expect(service.listRules(scope.workspaceId)).toEqual([]);
    expect(() => service.removeRule(rule!.id)).toThrow(/não encontrada/);
  });
});
