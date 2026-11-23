import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateManifestSchema } from '../src/shared/app-update';
import { publish, sha512File } from './publish-update.mjs';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-publish-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('publish-update', () => {
  const content = Buffer.from('instalador de mentira');

  it('copia o instalador e grava um manifesto que o app aceita, com o SHA-512 certo', async () => {
    const installer = path.join(dir, 'Nexus-1.2.3-instalador.exe');
    fs.writeFileSync(installer, content);
    const dest = path.join(dir, 'versoes');
    const manifest = await publish({
      installer,
      version: '1.2.3',
      destDir: dest,
      now: new Date('2026-11-23T12:00:00Z'),
    });
    expect(
      updateManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dest, 'nexus-update.json'), 'utf8'))),
    ).toEqual(manifest);
    expect(manifest).toMatchObject({
      version: '1.2.3',
      file: 'Nexus-1.2.3-instalador.exe',
      sha512: createHash('sha512').update(content).digest('hex'),
      releasedAt: '2026-11-23T12:00:00.000Z',
    });
    expect(fs.readFileSync(path.join(dest, manifest.file)).equals(content)).toBe(true);
    expect(fs.readdirSync(dest).sort()).toEqual(['Nexus-1.2.3-instalador.exe', 'nexus-update.json']);
    expect(await sha512File(installer)).toBe(manifest.sha512);
  });

  it('recusa versão inválida e instalador ausente', async () => {
    await expect(publish({ installer: path.join(dir, 'x.exe'), version: '1.2', destDir: dir })).rejects.toThrow(
      /Versão inválida/,
    );
    await expect(publish({ installer: path.join(dir, 'x.exe'), version: '1.2.3', destDir: dir })).rejects.toThrow(
      /npm run dist/,
    );
  });
});
