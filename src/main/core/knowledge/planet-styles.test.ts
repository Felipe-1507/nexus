import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './vault';
import { PLANET_STYLES_FILE, PlanetStyleStore } from './planet-styles';

let dir: string;
let store: PlanetStyleStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-planets-'));
  store = new PlanetStyleStore(() => dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('aparência dos planetas guardada', () => {
  it('começa vazia, grava só o que foi trocado e relê', () => {
    expect(store.get('w')).toEqual({});
    store.set('w', 'A/x.md', { kind: 'lava', color: '#ff0000' });
    store.set('w', 'B/y.md', { ring: true });
    expect(store.get('w')).toEqual({ 'A/x.md': { kind: 'lava', color: '#ff0000' }, 'B/y.md': { ring: true } });
  });

  it('um objeto vazio ou null devolve o planeta ao sorteio', () => {
    store.set('w', 'A/x.md', { ring: true });
    expect(store.set('w', 'A/x.md', {})).toEqual({});
    store.set('w', 'A/x.md', { ring: true });
    expect(store.set('w', 'A/x.md', null)).toEqual({});
  });

  it('arquivo estragado ou com valor inválido é ignorado, sem derrubar a galáxia', () => {
    fs.writeFileSync(path.join(dir, PLANET_STYLES_FILE), '{ quebrado');
    expect(store.get('w')).toEqual({});
    fs.writeFileSync(path.join(dir, PLANET_STYLES_FILE), JSON.stringify({ 'a.md': { kind: 'estrela' } }));
    expect(store.get('w')).toEqual({});
  });

  it('o arquivo fica oculto: não aparece como nota nem na árvore do vault', () => {
    store.set('w', 'A/x.md', { ring: true });
    fs.writeFileSync(path.join(dir, 'Nota.md'), '# Nota');
    const vault = new Vault(dir);
    expect(vault.listNotes().map((n) => n.path)).toEqual(['Nota.md']);
    expect(vault.tree().children?.map((c) => c.name)).toEqual(['Nota']);
  });
});
