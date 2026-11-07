import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './vault';

let base: string;
let vault: Vault;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-vault-'));
  vault = new Vault(path.join(base, 'Conhecimentos'));
  vault.ensure();
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const write = (rel: string, content = 'x') => {
  const file = path.join(vault.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe('árvore', () => {
  it('lista pastas e notas .md, ignorando ocultos e outros arquivos', () => {
    write('Processos/Fechamento.md');
    write('Processos/anexo.pdf');
    write('Ideias.md');
    write('.obsidian/workspace.json');
    write('.trash/velha.md');
    expect(vault.tree().children).toEqual([
      {
        type: 'folder',
        name: 'Processos',
        path: 'Processos',
        children: [{ type: 'note', name: 'Fechamento', path: 'Processos/Fechamento.md' }],
      },
      { type: 'note', name: 'Ideias', path: 'Ideias.md' },
    ]);
  });
});

describe('notas', () => {
  it('cria com nome válido e sem sobrescrever', () => {
    expect(vault.create('', 'Conciliação: Itaú?')).toBe('Conciliação Itaú.md');
    expect(vault.create('', 'Conciliação: Itaú?')).toBe('Conciliação Itaú 1.md');
    expect(vault.read('Conciliação Itaú.md').content).toBe('# Conciliação: Itaú?\n\n');
  });

  it('grava com detecção de conflito', () => {
    const rel = vault.create('', 'A');
    const { mtimeMs } = vault.read(rel);
    vault.write(rel, 'novo', mtimeMs);
    expect(vault.read(rel).content).toBe('novo');
    expect(() => vault.write(rel, 'atrasado', mtimeMs - 10_000)).toThrow(/alterada fora/);
  });

  it('pastas, renomear, mover e lixeira', () => {
    const folder = vault.createFolder('', 'Processos');
    const note = vault.create('', 'Rascunho');
    const renamed = vault.rename(note, 'Fechamento');
    expect(renamed).toBe('Fechamento.md');
    expect(vault.move(renamed, folder)).toBe('Processos/Fechamento.md');
    vault.trash('Processos/Fechamento.md');
    expect(fs.existsSync(path.join(vault.root, '.trash', 'Fechamento.md'))).toBe(true);
    expect(vault.tree().children).toEqual([{ type: 'folder', name: 'Processos', path: 'Processos', children: [] }]);
    expect(() => vault.move('Processos', 'Processos')).toThrow(/dentro dela mesma/);
  });
});

describe('segurança', () => {
  it('recusa caminhos fora do vault e pastas ocultas', () => {
    fs.writeFileSync(path.join(base, 'segredo.md'), 'segredo');
    for (const rel of ['../segredo.md', '..\\segredo.md', 'C:/Windows/win.ini', '\\\\srv\\x.md', '.obsidian/a.md']) {
      expect(() => vault.read(rel), rel).toThrow();
    }
    expect(() => vault.create('../', 'fora')).toThrow();
    expect(() => vault.read('nota.txt')).toThrow(/Só notas/);
  });

  it('não segue junction/link que aponte para fora', () => {
    const outside = path.join(base, 'fora');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'segredo.md'), 'segredo');
    fs.symlinkSync(outside, path.join(vault.root, 'atalho'), 'junction');

    expect(vault.tree().children).toEqual([]);
    // A varredura rápida do índice (sem conferir o caminho real a cada arquivo) também não entra no link.
    expect(vault.listNotes()).toEqual([]);
    expect(() => vault.read('atalho/segredo.md')).toThrow(/fora da pasta/);
    expect(() => vault.create('atalho', 'nova')).toThrow(/fora da pasta/);
    expect(fs.readdirSync(outside)).toEqual(['segredo.md']);
  });
});
