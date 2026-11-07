import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PALETTE_TOKENS } from '@shared/palette';
import { artifactBase, loadBranding, THEME_TOKENS } from '../../../scripts/branding.mjs';

let base: string;
let dir: string;
let file: string;
const where = () => ({ dir, file });

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-brand-'));
  dir = path.join(base, 'branding.local');
  file = path.join(base, 'branding.local.json');
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const put = (name: string, content: string | Buffer) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
};

/** PNG mínimo, só com assinatura e IHDR (o que o carregador lê para conferir o tamanho). */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe('marca do app', () => {
  it('sem nada local, o app se chama "Nexus", sem autor, cores, logo nem ícone próprios', () => {
    expect(loadBranding(where())).toEqual({
      productName: 'Nexus',
      appId: 'local.nexus.app',
      author: null,
      theme: null,
      logo: null,
      icon: null,
    });
  });

  it('a pasta local traz nome, cores, logo e ícone', () => {
    put('branding.json', JSON.stringify({ productName: 'Meu Nexus', appId: 'com.exemplo.meunexus', author: 'Fulano' }));
    put('theme.json', JSON.stringify({ dark: { bg: '#0a1020', accent: '#4f8cffcc' }, galaxy: ['#ffffff', '#4f8cff'] }));
    put('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    put('icon.png', png(512, 512));
    const b = loadBranding(where());
    expect(b).toMatchObject({
      productName: 'Meu Nexus',
      appId: 'com.exemplo.meunexus',
      author: 'Fulano',
      theme: { dark: { bg: '#0a1020', accent: '#4f8cffcc' }, galaxy: ['#ffffff', '#4f8cff'] },
      icon: path.join(dir, 'icon.png'),
    });
    expect(b.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(artifactBase(b)).toBe('Meu-Nexus');
  });

  it('só o nome também pode vir do arquivo branding.local.json', () => {
    fs.writeFileSync(file, JSON.stringify({ productName: 'Outro' }));
    expect(loadBranding(where())).toMatchObject({ productName: 'Outro', appId: 'local.nexus.app', theme: null });
  });

  it.each([
    ['branding.json', JSON.stringify({ productName: 'Nexus: trabalho' }), /productName/],
    ['branding.json', JSON.stringify({ appId: 'sem-ponto' }), /appId/],
    ['branding.json', JSON.stringify({ author: 42 }), /author/],
    ['branding.json', '{ quebrado', /JSON inválido/],
    ['theme.json', JSON.stringify({ dark: { fundo: '#000000' } }), /"dark.fundo" não existe/],
    ['theme.json', JSON.stringify({ light: { bg: 'azul' } }), /"light.bg" precisa ser #rrggbb/],
    ['theme.json', JSON.stringify({ galaxy: [] }), /"galaxy"/],
    ['theme.json', JSON.stringify({ escuro: {} }), /"escuro" não existe/],
    ['icon.png', png(256, 128), /quadrado/],
    ['icon.png', png(128, 128), /256×256/],
    ['icon.png', Buffer.from('não é png'), /PNG/],
  ])('recusa %s inválido em vez de gerar um app quebrado', (name, content, message) => {
    put(name, content);
    expect(() => loadBranding(where())).toThrow(message);
  });

  it('as cores aceitas pela marca são as mesmas da paleta do app', () => {
    expect([...THEME_TOKENS]).toEqual([...PALETTE_TOKENS]);
  });
});
