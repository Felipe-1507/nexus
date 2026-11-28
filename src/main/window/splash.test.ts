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
    expect(splashHtml({ accent: 'red;}</style>', name: 'Nexus' })).toContain('stroke="#ff4560"');
  });

  it('mistura cores', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#e03e3e', '#ffffff', 0)).toBe('#e03e3e');
  });
});

describe('abertura da marca', () => {
  const dir = path.resolve('build', 'intro');

  it('a página e o vídeo existem, a página toca o vídeo sem script e o CSP libera só mídia local', () => {
    expect(fs.statSync(path.join(dir, 'intro.mp4')).size).toBeGreaterThan(10_000);
    const html = fs.readFileSync(path.join(dir, 'splash.html'), 'utf8');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('src="intro.mp4"');
    expect(html).toMatch(/autoplay/);
    expect(html).toContain("default-src 'none'; media-src file:");
    // Os controles do player aparecem sozinhos sem JavaScript: a página os esconde.
    expect(html).toContain('::-webkit-media-controls');
  });

  it('com "reduzir movimento", a página troca o vídeo pela logo parada', () => {
    const html = fs.readFileSync(path.join(dir, 'splash.html'), 'utf8');
    expect(html).toMatch(/<svg class="still"/);
    expect(html).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*video \{ display: none; \}/);
  });

  it('o instalador leva a pasta da abertura fora do ASAR', () => {
    expect(fs.readFileSync('electron-builder.config.mjs', 'utf8')).toMatch(/from: 'build\/intro', to: 'intro'/);
  });
});
