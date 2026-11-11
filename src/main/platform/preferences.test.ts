import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPreferences, savePreferences } from './preferences';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prefs-'));
  file = path.join(dir, 'preferences.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('preferências', () => {
  it('usa os padrões quando o arquivo não existe', () => {
    expect(loadPreferences(file)).toEqual({
      preferences: {
        version: 1,
        dataRoot: null,
        theme: 'system',
        privacyAcceptedAt: null,
        darkVariant: 'padrao',
        seenModels: null,
        galaxyQuality: 'leve',
        accent: null,
      },
    });
  });

  it('grava e relê', () => {
    const prefs = {
      version: 1 as const,
      dataRoot: 'D:\\Dados',
      theme: 'dark' as const,
      privacyAcceptedAt: null,
      darkVariant: 'grafite' as const,
      seenModels: ['opus', 'sonnet'],
      galaxyQuality: 'original' as const,
      accent: '#4f8cff',
    };
    savePreferences(file, prefs);
    expect(loadPreferences(file).preferences).toEqual(prefs);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('cai nos padrões com aviso quando o JSON está corrompido', () => {
    fs.writeFileSync(file, '{ "theme": ');
    const r = loadPreferences(file);
    expect(r.preferences.theme).toBe('system');
    expect(r.warning).toMatch(/JSON inválido/);
  });

  it('cai nos padrões com aviso quando um valor é inválido', () => {
    fs.writeFileSync(file, JSON.stringify({ theme: 'roxo' }));
    const r = loadPreferences(file);
    expect(r.preferences.theme).toBe('system');
    expect(r.warning).toMatch(/inválidas/);
  });

  it('arquivos de versões anteriores continuam válidos e ainda pedem o aviso de privacidade', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, dataRoot: null, theme: 'dark' }));
    const r = loadPreferences(file);
    expect(r.warning).toBeUndefined();
    expect(r.preferences).toMatchObject({ theme: 'dark', privacyAcceptedAt: null });
  });
});
