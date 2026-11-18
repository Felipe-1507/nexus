import { describe, expect, it } from 'vitest';
import { excerpt, foldText, hasAll, parseQuery } from './search-text';

/** As palavras que o trecho marca, na ordem. */
const marked = (e: { text: string; ranges: Array<[number, number]> }) => e.ranges.map(([s, t]) => e.text.slice(s, t));

describe('parseQuery', () => {
  it('separa por espaço, ignora maiúsculas e acentos e tira repetidas', () => {
    expect(parseQuery('  Situação  fiscal situacao ')).toEqual(['situacao', 'fiscal']);
  });

  it('o que está entre aspas vale como uma palavra só', () => {
    expect(parseQuery('"nota fiscal" ST')).toEqual(['nota fiscal', 'st']);
  });

  it('limita a quantidade de palavras', () => {
    expect(parseQuery('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('hasAll', () => {
  it('exige todas as palavras, sem diferenciar acento nem caixa', () => {
    const text = foldText('A Situação do CEST está em análise');
    expect(hasAll(text, parseQuery('situacao cest'))).toBe(true);
    expect(hasAll(text, parseQuery('situacao icms'))).toBe(false);
    expect(hasAll(text, [])).toBe(false);
  });
});

describe('excerpt', () => {
  it('marca a palavra no texto original, com a acentuação de lá', () => {
    const e = excerpt('Vamos corrigir a Situação tributária hoje.', parseQuery('situacao'))!;
    expect(e.text).toBe('Vamos corrigir a Situação tributária hoje.');
    expect(marked(e)).toEqual(['Situação']);
  });

  it('marca todas as palavras e junta as que se encostam', () => {
    const e = excerpt('O CEST do item e o CEST da nota', parseQuery('cest item'))!;
    expect(marked(e)).toEqual(['CEST', 'item', 'CEST']);
    const joined = excerpt('abc abcd', ['abc', 'abcd'])!;
    expect(marked(joined)).toEqual(['abc', 'abcd']);
    const overlap = excerpt('nota fiscal', ['nota', 'nota fiscal'])!;
    expect(marked(overlap)).toEqual(['nota fiscal']);
  });

  it('em texto longo, corta em volta da palavra, com reticências e sem partir palavras', () => {
    const long = `${'palavra '.repeat(80)}ALVO ${'resto '.repeat(80)}`;
    const e = excerpt(long, ['alvo'])!;
    expect(e.text.startsWith('…')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    expect(e.text.length).toBeLessThan(260);
    expect(marked(e)).toEqual(['ALVO']);
    expect(e.text).not.toMatch(/palavr[^a]|rest[^o]/);
  });

  it('quebras de linha viram espaços sem mexer nas posições', () => {
    const e = excerpt('linha um\n\nlinha dois com a palavra\nfinal', ['final'])!;
    expect(e.text).not.toMatch(/\n/);
    expect(marked(e)).toEqual(['final']);
  });

  it('devolve null quando não acha', () => {
    expect(excerpt('nada por aqui', ['xyz'])).toBeNull();
  });

  it('funciona com emoji e letras fora do básico', () => {
    const e = excerpt('😀 Pão de açúcar 🎉 e AÇÚCAR', ['acucar'])!;
    expect(marked(e)).toEqual(['açúcar', 'AÇÚCAR']);
  });
});
