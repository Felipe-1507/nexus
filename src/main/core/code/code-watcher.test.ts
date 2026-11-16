import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeEvent, CodeScope } from '@shared/code';
import { CodeWatcher } from './code-watcher';

let root: string;
let events: CodeEvent[];
let watcher: CodeWatcher;
const scope: CodeScope = { workspaceId: '11111111-1111-4111-8111-111111111111', projectId: null };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-codewatch-'));
  fs.mkdirSync(path.join(root, 'src', 'sub'), { recursive: true });
  events = [];
  watcher = new CodeWatcher({ resolveRoot: async () => root, emit: (e) => events.push(e), debounceMs: 50 });
});
afterEach(() => {
  watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('observação das pastas abertas na árvore', () => {
  it('avisa quando algo entra ou sai de uma pasta observada, e só dela', async () => {
    await watcher.set(scope, ['', 'src']);
    // Dá tempo de o sistema de arquivos começar a observar.
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(root, 'novo.txt'), 'x');
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'x');
    await waitFor(() => new Set(events.flatMap((e) => e.dirs)).size >= 2);
    expect(new Set(events.flatMap((e) => e.dirs))).toEqual(new Set(['', 'src']));
    expect(events[0]).toMatchObject({ workspaceId: scope.workspaceId, projectId: null });

    // Uma pasta que a árvore não mostra aberta não é observada.
    events.length = 0;
    fs.writeFileSync(path.join(root, 'src', 'sub', 'fundo.ts'), 'x');
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toEqual([]);
  });

  it('pasta nova e item removido também avisam; editar o conteúdo de um arquivo não', async () => {
    fs.writeFileSync(path.join(root, 'src', 'velho.ts'), 'x');
    await watcher.set(scope, ['src']);
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(root, 'src', 'velho.ts'), 'editado');
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toEqual([]);
    fs.mkdirSync(path.join(root, 'src', 'pasta-nova'));
    await waitFor(() => events.length > 0);
    events.length = 0;
    fs.rmSync(path.join(root, 'src', 'velho.ts'));
    await waitFor(() => events.length > 0);
    expect(events[0]!.dirs).toEqual(['src']);
  });

  it('parar de observar (lista vazia) e caminhos fora da raiz', async () => {
    await watcher.set(scope, ['', '../fora', 'C:']);
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(root, 'a.txt'), 'x');
    await waitFor(() => events.length > 0);
    events.length = 0;
    await watcher.set(scope, []);
    fs.writeFileSync(path.join(root, 'b.txt'), 'x');
    await new Promise((r) => setTimeout(r, 600));
    expect(events).toEqual([]);
  });

  it('raiz que não resolve (projeto removido) não observa nada e não dá erro', async () => {
    const broken = new CodeWatcher({
      resolveRoot: async () => {
        throw new Error('sem pasta');
      },
      emit: (e) => events.push(e),
    });
    await expect(broken.set(scope, [''])).resolves.toBeUndefined();
    broken.close();
  });
});
