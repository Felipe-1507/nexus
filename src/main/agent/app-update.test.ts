import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateService, checkSource, type AppUpdateDeps } from './app-update';

let root: string;
let feed: string;
const INSTALLER = Buffer.from('conteúdo do instalador '.repeat(500));
const sha = (b: Buffer) => createHash('sha512').update(b).digest('hex');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-appupdate-'));
  feed = path.join(root, 'feed');
  fs.mkdirSync(feed);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function publish(version: string, over: { file?: string; sha512?: string; content?: Buffer } = {}) {
  const file = over.file ?? `Nexus-${version}-instalador.exe`;
  const content = over.content ?? INSTALLER;
  if (!file.includes('/')) fs.writeFileSync(path.join(feed, file), content);
  fs.writeFileSync(
    path.join(feed, 'nexus-update.json'),
    JSON.stringify({ version, file, sha512: over.sha512 ?? sha(content) }),
  );
}

function make(over: Partial<AppUpdateDeps> = {}) {
  const launch = vi.fn();
  const quit = vi.fn();
  let now = 1_000_000;
  const service = new AppUpdateService({
    source: () => feed,
    currentVersion: '0.2.0',
    downloadDir: path.join(root, 'downloads'),
    fetch: async () => new Response('', { status: 404 }),
    launch,
    quit,
    now: () => now,
    ...over,
  });
  return { service, launch, quit, tick: (ms: number) => (now += ms) };
}

describe('checkSource', () => {
  it('aceita pasta, HTTPS e HTTP só local; recusa HTTP externo', () => {
    expect(checkSource('\\\\srv\\versoes')).toEqual({ kind: 'folder', dir: '\\\\srv\\versoes' });
    expect(checkSource('https://exemplo.com/v')).toEqual({ kind: 'url', base: 'https://exemplo.com/v/' });
    expect(checkSource('http://localhost:8080/')).toEqual({ kind: 'url', base: 'http://localhost:8080/' });
    expect(() => checkSource('http://exemplo.com/')).toThrow(/HTTPS/);
  });
});

describe('AppUpdateService.check', () => {
  it('desligado: não consulta nada', async () => {
    const { service } = make({ source: () => null });
    expect(await service.check()).toMatchObject({ configured: false, available: false, error: null });
  });

  it('compara a versão do manifesto com a instalada', async () => {
    publish('0.3.0');
    const { service } = make();
    expect(await service.check()).toMatchObject({ configured: true, latest: '0.3.0', available: true, error: null });
    publish('0.2.0');
    expect(await make().service.check()).toMatchObject({ latest: '0.2.0', available: false });
    publish('0.1.9');
    expect((await make().service.check()).available).toBe(false);
  });

  it('guarda a resposta por horas e "verificar agora" consulta de novo', async () => {
    publish('0.3.0');
    const { service, tick } = make();
    expect((await service.check()).latest).toBe('0.3.0');
    publish('0.4.0');
    expect((await service.check()).latest).toBe('0.3.0');
    tick(5 * 60 * 60_000);
    expect((await service.check()).latest).toBe('0.4.0');
    publish('0.5.0');
    expect((await service.check(true)).latest).toBe('0.5.0');
  });

  it('falhas viram erro no estado, sem lançar', async () => {
    expect((await make().service.check()).error).toMatch(/Não há nexus-update\.json/);
    fs.writeFileSync(path.join(feed, 'nexus-update.json'), '{ quebrado');
    expect((await make().service.check()).error).toMatch(/não é um JSON válido/);
    fs.writeFileSync(
      path.join(feed, 'nexus-update.json'),
      JSON.stringify({ version: '1', file: '..\\x.exe', sha512: 'a' }),
    );
    expect((await make().service.check()).error).toMatch(/inválido/);
  });

  it('manifesto com caminho no nome do arquivo é recusado', async () => {
    fs.writeFileSync(
      path.join(feed, 'nexus-update.json'),
      JSON.stringify({ version: '9.9.9', file: '..\\..\\malicioso.exe', sha512: 'a'.repeat(128) }),
    );
    const status = await make().service.check();
    expect(status.available).toBe(false);
    expect(status.error).toMatch(/inválido/);
  });

  it('consulta por endereço HTTPS', async () => {
    const urls: string[] = [];
    const { service } = make({
      source: () => 'https://exemplo.com/versoes',
      fetch: async (url) => {
        urls.push(url);
        return new Response(JSON.stringify({ version: '1.0.0', file: 'N.exe', sha512: sha(INSTALLER) }), {
          status: 200,
        });
      },
    });
    expect(await service.check()).toMatchObject({ latest: '1.0.0', available: true });
    expect(urls).toEqual(['https://exemplo.com/versoes/nexus-update.json']);
  });
});

describe('AppUpdateService.install', () => {
  it('copia, confere o SHA-512, inicia o instalador em silêncio e fecha o app', async () => {
    publish('0.3.0');
    const { service, launch, quit } = make();
    await service.install();
    const file = path.join(root, 'downloads', 'Nexus-0.3.0-instalador.exe');
    expect(fs.readFileSync(file).equals(INSTALLER)).toBe(true);
    expect(launch).toHaveBeenCalledWith(file, ['/S', '--updated', '--force-run']);
    expect(quit).toHaveBeenCalledOnce();
    expect(fs.existsSync(`${file}.parcial`)).toBe(false);
  });

  it('instalador que não confere com o SHA-512 não roda e não deixa rastro', async () => {
    publish('0.3.0', { sha512: sha(Buffer.from('outro conteúdo')) });
    const { service, launch, quit } = make();
    await expect(service.install()).rejects.toThrow(/não confere com o SHA-512/);
    expect(launch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(root, 'downloads'))).toEqual([]);
  });

  it('sem versão nova ou com erro de consulta, recusa', async () => {
    publish('0.2.0');
    await expect(make().service.install()).rejects.toThrow(/já está na versão mais nova/);
    fs.rmSync(path.join(feed, 'nexus-update.json'));
    await expect(make().service.install()).rejects.toThrow(/Não há nexus-update\.json/);
  });

  it('baixa de um endereço HTTPS e confere o SHA-512', async () => {
    const { service, launch } = make({
      source: () => 'https://exemplo.com/v/',
      fetch: async (url) =>
        url.endsWith('.json')
          ? new Response(
              JSON.stringify({ version: '0.3.0', file: 'Nexus-0.3.0-instalador.exe', sha512: sha(INSTALLER) }),
            )
          : new Response(INSTALLER),
    });
    await service.install();
    expect(launch).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(root, 'downloads', 'Nexus-0.3.0-instalador.exe')).equals(INSTALLER)).toBe(true);
  });
});
