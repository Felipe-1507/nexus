import { describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  DARK_VARIANTS,
  DEFAULT_APPEARANCE,
  DEFAULT_PALETTE,
  mergePalette,
  mixHex,
  PALETTE_TOKENS,
  paletteCss,
  withAppearance,
} from './palette';

describe('paleta de cores', () => {
  it('a marca troca só as cores que definir; o resto continua o padrão', () => {
    const p = mergePalette(DEFAULT_PALETTE, { dark: { bg: '#0a1020' }, galaxy: ['#ffffff'] });
    expect(p.dark.bg).toBe('#0a1020');
    expect(p.dark.accent).toBe(DEFAULT_PALETTE.dark.accent);
    expect(p.light).toEqual(DEFAULT_PALETTE.light);
    expect(p.galaxy).toEqual(['#ffffff']);
    expect(mergePalette(DEFAULT_PALETTE, null)).toEqual(DEFAULT_PALETTE);
  });

  it('gera todas as variáveis nos dois temas, o escuro dentro da media query', () => {
    const css = paletteCss(mergePalette(DEFAULT_PALETTE, { dark: { bg: '#0a1020' } }));
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    for (const token of PALETTE_TOKENS) {
      expect(light).toContain(`--${token}: ${DEFAULT_PALETTE.light[token]};`);
      expect(dark).toContain(`--${token}:`);
    }
    expect(dark).toContain('--bg: #0a1020;');
    expect(light).toContain('color-scheme: light');
    expect(dark).toContain('color-scheme: dark');
  });
});

describe('aparência escolhida pelo usuário', () => {
  it('a variação troca o fundo do escuro e mantém o destaque; o claro não muda', () => {
    const p = withAppearance(DEFAULT_PALETTE, { darkVariant: 'azul-noite', accent: null });
    expect(p.dark.bg).toBe(DARK_VARIANTS['azul-noite'].colors.bg);
    expect(p.dark.accent).toBe(DEFAULT_PALETTE.dark.accent);
    expect(p.light).toEqual(DEFAULT_PALETTE.light);
    expect(withAppearance(DEFAULT_PALETTE, DEFAULT_APPEARANCE)).toEqual(DEFAULT_PALETTE);
  });

  it('a cor de destaque vale nos dois temas, um pouco mais escura no claro', () => {
    const p = withAppearance(DEFAULT_PALETTE, { darkVariant: 'preto', accent: '#4f8cff' });
    expect(p.dark).toMatchObject({ bg: '#000000', accent: '#4f8cff', 'accent-soft': '#4f8cff26' });
    expect(p.light.accent).toBe(mixHex('#4f8cff', '#000000', 0.15));
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
  });

  it('as variações e as cores prontas são válidas', () => {
    for (const v of Object.values(DARK_VARIANTS))
      for (const c of Object.values(v.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    for (const a of ACCENT_PRESETS) if (a.hex) expect(a.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
