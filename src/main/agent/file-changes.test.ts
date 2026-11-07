import { describe, expect, it } from 'vitest';
import { CHANGE_MAX_CHARS, FileChangeTracker } from './file-changes';

// Formatos reais do Claude Code 2.1.295 (spikes/claude-sdk/tool-results.mjs).
const write = (filePath: string, content: string, originalFile: string | null = null) => ({
  type: originalFile === null ? 'create' : 'update',
  filePath,
  content,
  structuredPatch: [],
  originalFile,
  userModified: false,
});
const edit = (filePath: string, originalFile: string, oldString: string, newString: string, replaceAll = false) => ({
  filePath,
  oldString,
  newString,
  originalFile,
  structuredPatch: [],
  userModified: false,
  replaceAll,
});

describe('FileChangeTracker', () => {
  it('arquivo criado: sem antes, com depois', () => {
    const t = new FileChangeTracker();
    t.record(write('C:\\p\\novo.txt', 'ola'));
    expect(t.list()).toEqual([
      { path: 'C:\\p\\novo.txt', kind: 'create', before: null, after: 'ola', truncated: false },
    ]);
  });

  it('várias edições no mesmo arquivo: antes da primeira, depois da última', () => {
    const t = new FileChangeTracker();
    t.record(edit('C:\\p\\config.txt', 'porta=3000\nmodo=dev\n', 'porta=3000', 'porta=8080'));
    t.record(edit('C:\\p\\config.txt', 'porta=8080\nmodo=dev\n', 'modo=dev', 'modo=prod'));
    expect(t.list()).toEqual([
      {
        path: 'C:\\p\\config.txt',
        kind: 'edit',
        before: 'porta=3000\nmodo=dev\n',
        after: 'porta=8080\nmodo=prod\n',
        truncated: false,
      },
    ]);
  });

  it('replaceAll troca todas as ocorrências e $ não é tratado como padrão', () => {
    const t = new FileChangeTracker();
    t.record(edit('a.ts', 'x x x', 'x', 'y', true));
    t.record(edit('b.ts', 'preco', 'preco', '$1 e $&'));
    expect(t.list().map((c) => c.after)).toEqual(['y y y', '$1 e $&']);
  });

  it('sobrescrever um arquivo existente é edição', () => {
    const t = new FileChangeTracker();
    t.record(write('a.md', 'novo', 'velho'));
    expect(t.list()[0]).toMatchObject({ kind: 'edit', before: 'velho', after: 'novo' });
  });

  it('ignora o que não altera arquivos e não guarda conteúdo gigante', () => {
    const t = new FileChangeTracker();
    t.record({ type: 'text', file: { filePath: 'a', content: 'x' } });
    t.record({ stdout: 'ok' });
    t.record(null);
    t.record(write('grande.log', 'x'.repeat(CHANGE_MAX_CHARS + 1)));
    expect(t.list()).toEqual([{ path: 'grande.log', kind: 'create', before: null, after: null, truncated: true }]);
  });
});
