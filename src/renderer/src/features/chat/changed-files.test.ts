import { describe, expect, it } from 'vitest';
import { notePathIn } from './ChangedFiles';

describe('notePathIn', () => {
  const dir = 'C:\\Users\\u\\Nexus\\workspaces\\fin-1a2b\\Conhecimentos';

  it('reconhece notas do vault, ignorando maiúsculas e o tipo de barra', () => {
    expect(notePathIn(dir, `${dir}\\Processos\\Fechamento.md`)).toBe('Processos/Fechamento.md');
    expect(notePathIn(dir, 'c:/users/u/nexus/workspaces/fin-1a2b/conhecimentos/A.MD')).toBe('A.MD');
  });

  it('o resto não é nota', () => {
    expect(notePathIn(dir, `${dir}\\planilha.xlsx`)).toBeNull();
    expect(notePathIn(dir, `${dir}-copia\\A.md`)).toBeNull();
    expect(notePathIn(dir, 'C:\\dev\\projeto\\README.md')).toBeNull();
  });
});
