import { describe, expect, it } from 'vitest';
import {
  generatePlanetStyle,
  PLANET_KINDS,
  planetColors,
  planetOverrideSchema,
  PLANET_MAX_SIZE,
  planetSize,
  resolvePlanetStyle,
  autoPlanetStyle,
} from './planets';

describe('aparência dos planetas', () => {
  it('é aleatória, mas estável: o mesmo caminho dá sempre o mesmo planeta', () => {
    const a = generatePlanetStyle('Trabalho/Conciliação.md');
    expect(generatePlanetStyle('Trabalho/Conciliação.md')).toEqual(a);
    expect(generatePlanetStyle('Trabalho/Bancos.md')).not.toEqual(a);
  });

  it('com muitas notas, aparecem todos os tipos, alguns planetas com anéis e a maioria com atmosfera', () => {
    const styles = Array.from({ length: 600 }, (_, i) => generatePlanetStyle(`Pasta ${i % 7}/Nota ${i}.md`));
    // O metálico não sai no sorteio: é das notas com código (aparência automática).
    for (const kind of PLANET_KINDS.filter((k) => k !== 'metalico'))
      expect(styles.some((s) => s.kind === kind)).toBe(true);
    expect(styles.some((s) => s.kind === 'metalico')).toBe(false);
    const rings = styles.filter((s) => s.ring).length / styles.length;
    const atmos = styles.filter((s) => s.atmosphere).length / styles.length;
    expect(rings).toBeGreaterThan(0.08);
    expect(rings).toBeLessThan(0.35);
    expect(atmos).toBeGreaterThan(0.5);
    expect(styles.every((s) => s.color === null && s.detail === '')).toBe(true);
  });

  it('o que o usuário troca vale; o que ele não toca continua sorteado', () => {
    const base = generatePlanetStyle('A/x.md');
    const edited = resolvePlanetStyle('A/x.md', { kind: 'lava', color: '#ff0000', ring: true, detail: 'Principal' });
    expect(edited).toMatchObject({ kind: 'lava', color: '#ff0000', ring: true, detail: 'Principal' });
    expect(edited.atmosphere).toBe(base.atmosphere);
    expect(edited.seed).toBe(base.seed);
    expect(resolvePlanetStyle('A/x.md', null)).toEqual(base);
    expect(resolvePlanetStyle('A/x.md', {})).toEqual(base);
  });

  it('a cor escolhida gera as outras cores do planeta; sem escolha, vêm do tipo', () => {
    const chosen = planetColors({ ...generatePlanetStyle('a.md'), kind: 'gasoso', color: '#4f8cff' });
    expect(chosen.a).toBe('#4f8cff');
    expect(chosen.b).not.toBe(chosen.a);
    const lava = planetColors({ ...generatePlanetStyle('a.md'), kind: 'lava', color: '#ff6a2b' });
    expect(lava.b).toBe('#ff6a2b');
    for (const c of Object.values(planetColors(generatePlanetStyle('b.md')))) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('valida o que o usuário envia', () => {
    expect(planetOverrideSchema.safeParse({ kind: 'oceano', color: '#00ff88', seed: 12 }).success).toBe(true);
    expect(planetOverrideSchema.safeParse({ kind: 'estrela' }).success).toBe(false);
    expect(planetOverrideSchema.safeParse({ color: 'azul' }).success).toBe(false);
    expect(planetOverrideSchema.safeParse({ detail: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('aparência automática', () => {
  const traits = (over: Partial<{ chars: number; degree: number; codeBlocks: number; images: number }> = {}) => ({
    chars: 2000,
    degree: 1,
    codeBlocks: 0,
    images: 0,
    ...over,
  });

  it('reflete a nota: código vira metálico, extensa vira gigante gasoso, curta vira rochoso', () => {
    expect(autoPlanetStyle('a.md', traits({ codeBlocks: 3 })).kind).toBe('metalico');
    expect(autoPlanetStyle('a.md', traits({ chars: 20_000 })).kind).toBe('gasoso');
    expect(autoPlanetStyle('a.md', traits({ chars: 100 })).kind).toBe('rochoso');
    // Código pesa mais que o tamanho.
    expect(autoPlanetStyle('a.md', traits({ chars: 20_000, codeBlocks: 4 })).kind).toBe('metalico');
  });

  it('no meio-termo, nunca gasoso, e a galáxia continua variada', () => {
    const kinds = new Set(Array.from({ length: 300 }, (_, i) => autoPlanetStyle(`P/${i}.md`, traits()).kind));
    expect(kinds.has('gasoso')).toBe(false);
    expect(kinds.has('metalico')).toBe(false);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('muitas conexões dão anéis; imagens dão atmosfera', () => {
    expect(autoPlanetStyle('a.md', traits({ degree: 8 })).ring).toBe(true);
    expect(autoPlanetStyle('a.md', traits({ degree: 1 })).ring).toBe(false);
    expect(autoPlanetStyle('a.md', traits({ images: 2 })).atmosphere).toBe(true);
  });

  it('a escolha manual sempre vale por cima do automático, até ser apagada', () => {
    const t = traits({ codeBlocks: 5, degree: 9 });
    expect(resolvePlanetStyle('a.md', { kind: 'gelo', ring: false }, t)).toMatchObject({ kind: 'gelo', ring: false });
    expect(resolvePlanetStyle('a.md', null, t)).toMatchObject({ kind: 'metalico', ring: true });
    // Mudar só a cor mantém o tipo automático.
    expect(resolvePlanetStyle('a.md', { color: '#ff0000' }, t)).toMatchObject({ kind: 'metalico', color: '#ff0000' });
  });
});

describe('tamanho do planeta', () => {
  it('cresce com as conexões e com o conteúdo, com limite', () => {
    expect(planetSize(0, 0)).toBeLessThan(planetSize(4, 0));
    expect(planetSize(2, 200)).toBeLessThan(planetSize(2, 2_000));
    expect(planetSize(2, 2_000)).toBeLessThan(planetSize(2, 20_000));
    expect(planetSize(10_000, 10_000_000)).toBe(PLANET_MAX_SIZE);
  });

  it('uma nota com dez vezes mais conteúdo fica visivelmente maior', () => {
    expect(planetSize(1, 20_000) - planetSize(1, 2_000)).toBeGreaterThan(0.2);
  });
});
