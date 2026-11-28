import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mixHex, splashHtml } from './splash';

describe('abertura animada', () => {
  it('é só HTML e CSS: sem script, com CSP que bloqueia tudo além dos estilos', () => {
    const html = splashHtml({ accent: '#e03e3e', name: 'Nexus' });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`default-src 'none'; style-src 'unsafe-inline'`);
    expect(html).toContain('prefers-reduced-motion');
  });

  it('usa a cor de destaque do usuário e escapa o nome do app', () => {
    const html = splashHtml({ accent: '#e03e3e', name: 'Meu <Nexus>' });
    expect(html).toContain('stroke="#e03e3e"');
    expect(html).toContain('Meu &lt;Nexus&gt;');
    expect(html).not.toContain('<Nexus>');
  });

  it('cor inválida volta para a padrão', () => {
    expect(splashHtml({ accent: 'red;}</style>', name: 'Nexus' })).toContain('stroke="#8b7dff"');
  });

  it('mistura cores', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#e03e3e', '#ffffff', 0)).toBe('#e03e3e');
  });
});

describe('abertura da marca', () => {
  const dir = path.resolve('build', 'intro');

  it('a página desenha a logo e o nome só com SVG e CSS: sem script, sem vídeo e com CSP que bloqueia o resto', () => {
    const html = fs.readFileSync(path.join(dir, 'splash.html'), 'utf8');
    expect(html).not.toMatch(/<script|<video|<img/i);
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
    expect(html).toMatch(/<svg[^>]+viewBox="0 0 1000 1000"/);
    expect(html).toContain('>Nexus</text>');
    expect(html).toContain('prefers-reduced-motion');
  });

  it('o instalador leva a pasta da abertura fora do ASAR', () => {
    expect(fs.readFileSync('electron-builder.config.mjs', 'utf8')).toMatch(/from: 'build\/intro', to: 'intro'/);
  });
});
