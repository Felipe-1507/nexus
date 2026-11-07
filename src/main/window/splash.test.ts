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

describe('vídeo de abertura', () => {
  const dir = path.resolve('build', 'intro');

  it('a página e o vídeo existem, a página toca o vídeo sem script e o CSP libera só mídia local', () => {
    expect(fs.statSync(path.join(dir, 'intro.webm')).size).toBeGreaterThan(10_000);
    const html = fs.readFileSync(path.join(dir, 'splash.html'), 'utf8');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('src="intro.webm"');
    expect(html).toMatch(/autoplay/);
    expect(html).toContain("default-src 'none'; media-src file:");
  });

  it('o instalador leva a pasta do vídeo fora do ASAR', () => {
    expect(fs.readFileSync('electron-builder.config.mjs', 'utf8')).toMatch(/from: 'build\/intro', to: 'intro'/);
  });
});

it('a página do vídeo esconde os controles do player (aparecem sozinhos sem JavaScript)', () => {
  const html = fs.readFileSync(path.join('build', 'intro', 'splash.html'), 'utf8');
  expect(html).toContain('::-webkit-media-controls');
  expect(html).toContain('pointer-events: none');
});
