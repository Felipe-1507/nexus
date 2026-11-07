import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPreferences } from './preferences';
import { PreferencesStore } from './preferences-store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-store-'));
  file = path.join(dir, 'preferences.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('PreferencesStore', () => {
  it('grava a alteração em disco e notifica com o valor anterior', () => {
    const store = new PreferencesStore(file, loadPreferences(file).preferences);
    const listener = vi.fn();
    store.onChange(listener);

    store.update({ theme: 'dark' });

    expect(store.get().theme).toBe('dark');
    expect(loadPreferences(file).preferences.theme).toBe('dark');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
      expect.objectContaining({ theme: 'system' }),
    );
  });

  it('recusa valor inválido sem gravar nem notificar', () => {
    const store = new PreferencesStore(file, loadPreferences(file).preferences);
    const listener = vi.fn();
    store.onChange(listener);

    expect(() => store.update({ theme: 'roxo' as never })).toThrow();

    expect(store.get().theme).toBe('system');
    expect(fs.existsSync(file)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('para de notificar depois de cancelar a inscrição', () => {
    const store = new PreferencesStore(file, loadPreferences(file).preferences);
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    unsubscribe();
    store.update({ theme: 'light' });
    expect(listener).not.toHaveBeenCalled();
  });
});
