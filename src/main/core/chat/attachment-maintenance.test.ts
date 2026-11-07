import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentMaintenance } from './attachment-maintenance';
import { AttachmentService } from './attachment-service';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T12:00:00Z');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100)]);
const ws = '11111111-1111-4111-8111-111111111111';

let root: string;
let service: AttachmentService;
let sent: Set<string>;
let queued: Set<string>;
let maintenance: AttachmentMaintenance;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-clean-'));
  service = new AttachmentService({ workspaces: { get: () => ({ rootPath: root }) } as never });
  sent = new Set();
  queued = new Set();
  maintenance = new AttachmentMaintenance({
    workspaces: { list: () => [{ id: ws }] as never },
    attachments: service,
    chat: { attachmentsInUse: () => ({ sent, queued }) },
    now: () => NOW,
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Guarda um anexo e põe a data de modificação `days` dias atrás. */
function add(days: number): string {
  const a = service.save({ workspaceId: ws, name: 'a.png', mime: 'image/png', data: PNG.toString('base64') });
  const file = service.pathOf(ws, a);
  const when = new Date(NOW - days * DAY);
  fs.utimesSync(file, when, when);
  return a.id;
}
const exists = (id: string) => fs.existsSync(path.join(root, '.nexus', 'anexos', `${id}.png`));

describe('limpeza de anexos', () => {
  it('automática: só apaga o que nunca foi enviado e já passou de 3 dias', () => {
    const recentOrphan = add(1);
    const oldOrphan = add(5);
    const oldSent = add(200);
    sent.add(oldSent);
    expect(maintenance.pruneOrphans()).toEqual({ removed: 1, freedBytes: PNG.length });
    expect(exists(oldOrphan)).toBe(false);
    expect(exists(recentOrphan)).toBe(true);
    expect(exists(oldSent)).toBe(true);
  });

  it('pedida pelo usuário: apaga também os anexos de mensagens que passaram do prazo', () => {
    const newSent = add(10);
    const oldSent = add(120);
    sent.add(newSent).add(oldSent);
    expect(maintenance.cleanup(90).removed).toBe(1);
    expect(exists(oldSent)).toBe(false);
    expect(exists(newSent)).toBe(true);
  });

  it('nunca apaga o anexo de uma mensagem que ainda espera na fila', () => {
    const waiting = add(400);
    queued.add(waiting);
    expect(maintenance.cleanup(30)).toEqual({ removed: 0, freedBytes: 0 });
    expect(exists(waiting)).toBe(true);
  });

  it('só mexe em arquivos que o Nexus guardou (nome de id), nunca em outros', () => {
    const dir = path.join(root, '.nexus', 'anexos');
    add(1);
    fs.writeFileSync(path.join(dir, 'anotacao-do-usuario.txt'), 'meu');
    const old = new Date(NOW - 500 * DAY);
    fs.utimesSync(path.join(dir, 'anotacao-do-usuario.txt'), old, old);
    maintenance.cleanup(30);
    expect(fs.existsSync(path.join(dir, 'anotacao-do-usuario.txt'))).toBe(true);
  });

  it('informa quantos arquivos há e quanto espaço ocupam', () => {
    add(1);
    add(2);
    expect(maintenance.usage()).toEqual({ count: 2, bytes: PNG.length * 2 });
  });

  it('sem a pasta de anexos ainda, não há o que contar nem apagar', () => {
    expect(maintenance.usage()).toEqual({ count: 0, bytes: 0 });
    expect(maintenance.cleanup(30)).toEqual({ removed: 0, freedBytes: 0 });
  });
});
