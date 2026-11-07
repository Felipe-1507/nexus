import { describe, expect, it } from 'vitest';
import {
  generatePlanetStyle,
  PLANET_KINDS,
  planetColors,
  planetOverrideSchema,
  PLANET_MAX_SIZE,
  planetSize,
  resolvePlanetStyle,
} from './planets';

describe('aparência dos planetas', () => {
  it('é aleatória, mas estável: o mesmo caminho dá sempre o mesmo planeta', () => {
    const a = generatePlanetStyle('Trabalho/Conciliação.md');
    expect(generatePlanetStyle('Trabalho/Conciliação.md')).toEqual(a);
    expect(generatePlanetStyle('Trabalho/Bancos.md')).not.toEqual(a);
  });

  it('com muitas notas, aparecem todos os tipos, alguns planetas com anéis e a maioria com atmosfera', () => {
    const styles = Array.from({ length: 600 }, (_, i) => generatePlanetStyle(`Pasta ${i % 7}/Nota ${i}.md`));
    for (const kind of PLANET_KINDS) expect(styles.some((s) => s.kind === kind)).toBe(true);
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
