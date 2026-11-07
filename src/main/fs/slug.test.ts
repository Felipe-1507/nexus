import { describe, expect, it } from 'vitest';
import { isWindowsReservedName, sameName, slugify } from './slug';

describe('slugify', () => {
  it('remove acentos, símbolos e espaços', () => {
    expect(slugify('Trabalho')).toBe('trabalho');
    expect(slugify('Conciliação Bancária — Itaú!')).toBe('conciliacao-bancaria-itau');
    expect(slugify('  Pessoal / Estudos  ')).toBe('pessoal-estudos');
  });

  it('nunca devolve vazio', () => {
    expect(slugify('')).toBe('workspace');
    expect(slugify('🚀✨')).toBe('workspace');
    expect(slugify('---')).toBe('workspace');
  });

  it('evita nomes reservados do Windows', () => {
    expect(slugify('CON')).toBe('con-ws');
    expect(slugify('nul')).toBe('nul-ws');
    expect(slugify('COM1')).toBe('com1-ws');
    expect(slugify('Console')).toBe('console');
  });

  it('limita o tamanho sem terminar em hífen', () => {
    const s = slugify('a'.repeat(39) + ' bcdef', 40);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('isWindowsReservedName', () => {
  it('reconhece nomes reservados com e sem extensão', () => {
    expect(isWindowsReservedName('CON')).toBe(true);
    expect(isWindowsReservedName('aux.md')).toBe(true);
    expect(isWindowsReservedName('lpt9')).toBe(true);
    expect(isWindowsReservedName('contas')).toBe(false);
  });
});

describe('sameName', () => {
  it('ignora maiúsculas, acentos e espaços nas pontas', () => {
    expect(sameName('Finanças', ' financas ')).toBe(true);
    expect(sameName('Pessoal', 'Pessoal 2')).toBe(false);
  });
});
