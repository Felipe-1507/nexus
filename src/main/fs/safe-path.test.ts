import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from './safe-path';

const root = path.resolve('C:/nexus/raiz');

describe('resolveInside', () => {
  it('aceita caminhos dentro da raiz', () => {
    expect(resolveInside(root, 'index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveInside(root, 'assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveInside(root, 'a/../b.txt')).toBe(path.join(root, 'b.txt'));
    expect(resolveInside(root, '')).toBe(root);
  });

  it('aceita nomes que só começam com dois pontos', () => {
    expect(resolveInside(root, '..nota.md')).toBe(path.join(root, '..nota.md'));
  });

  it('rejeita saídas da raiz', () => {
    expect(resolveInside(root, '..')).toBeNull();
    expect(resolveInside(root, '../fora.txt')).toBeNull();
    expect(resolveInside(root, 'a/../../fora.txt')).toBeNull();
    expect(resolveInside(root, '..\\fora.txt')).toBeNull();
  });

  it('rejeita caminhos absolutos, outras unidades e UNC', () => {
    expect(resolveInside(root, 'C:/Windows/system32')).toBeNull();
    expect(resolveInside(root, 'D:/dados.txt')).toBeNull();
    expect(resolveInside(root, '\\\\servidor\\c$\\x')).toBeNull();
  });

  it('rejeita byte nulo', () => {
    expect(resolveInside(root, 'a.txt\0.png')).toBeNull();
  });
});
