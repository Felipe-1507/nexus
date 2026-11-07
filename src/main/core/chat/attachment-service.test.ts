import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentService, sniffMime } from './attachment-service';

let root: string;
let service: AttachmentService;
const workspaces = { get: () => ({ rootPath: root }) } as never;

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
const PDF = Buffer.from('%PDF-1.7\n%conteudo');
const b64 = (b: Buffer) => b.toString('base64');
const ws = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-att-'));
  service = new AttachmentService({ workspaces, thumbnail: () => 'data:image/png;base64,AAAA' });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('anexos do chat', () => {
  it('guarda o arquivo em .nexus/anexos do Workspace, com o id no nome, e devolve o caminho certo', () => {
    const a = service.save({ workspaceId: ws, name: 'tela.png', mime: 'image/png', data: b64(PNG) });
    expect(a).toMatchObject({ name: 'tela.png', mime: 'image/png', size: PNG.length });
    const file = service.pathOf(ws, a);
    expect(file).toBe(path.join(root, '.nexus', 'anexos', `${a.id}.png`));
    expect(fs.readFileSync(file)).toEqual(PNG);
  });

  it('confere o conteúdo: um .exe disfarçado de imagem ou um tipo errado é recusado', () => {
    expect(() =>
      service.save({
        workspaceId: ws,
        name: 'x.png',
        mime: 'image/png',
        data: b64(Buffer.from('MZ\x90\x00 programa')),
      }),
    ).toThrow(/não é do tipo informado/);
    expect(() => service.save({ workspaceId: ws, name: 'x.pdf', mime: 'application/pdf', data: b64(PNG) })).toThrow(
      /não é do tipo informado/,
    );
    expect(() => service.save({ workspaceId: ws, name: 'x.png', mime: 'image/png', data: '' })).toThrow(/vazio/);
  });

  it('recusa arquivo acima do limite de tamanho', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
    expect(() => service.save({ workspaceId: ws, name: 'g.pdf', mime: 'application/pdf', data: b64(big) })).toThrow(
      /limite/,
    );
  });

  it('o nome mostrado não carrega pastas nem caracteres de controle', () => {
    const a = service.save({
      workspaceId: ws,
      name: '..\\..\\Windows\\a\nb.pdf',
      mime: 'application/pdf',
      data: b64(PDF),
    });
    expect(a.name).toBe('ab.pdf');
    expect(service.pathOf(ws, a).startsWith(path.join(root, '.nexus', 'anexos'))).toBe(true);
  });

  it('só devolve caminho de anexo guardado: id forjado ou arquivo que sumiu falham', () => {
    const a = service.save({ workspaceId: ws, name: 'a.pdf', mime: 'application/pdf', data: b64(PDF) });
    expect(() => service.pathOf(ws, { ...a, id: '..\\..\\segredo' })).toThrow(/inválido/);
    expect(() => service.pathOf(ws, { ...a, id: '22222222-2222-4222-8222-222222222222' })).toThrow(
      /não foi encontrado/,
    );
    // O mesmo id com outro tipo aponta para outro arquivo, que não existe.
    expect(() => service.pathOf(ws, { ...a, mime: 'image/png' })).toThrow(/não foi encontrado/);
  });

  it('miniatura só para imagem; PDF e arquivo ausente voltam null', () => {
    const img = service.save({ workspaceId: ws, name: 'a.png', mime: 'image/png', data: b64(PNG) });
    const pdf = service.save({ workspaceId: ws, name: 'a.pdf', mime: 'application/pdf', data: b64(PDF) });
    expect(service.thumbnail(ws, img)).toMatch(/^data:image\/png/);
    expect(service.thumbnail(ws, pdf)).toBeNull();
    fs.rmSync(service.pathOf(ws, img));
    expect(service.thumbnail(ws, img)).toBeNull();
  });

  it('reconhece os tipos pelos primeiros bytes', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(Buffer.from('texto'))).toBeNull();
  });
});
