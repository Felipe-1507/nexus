import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeclaredExtensions, safeTarget, samePath } from './extensions-config';

const HOME = path.resolve('/home/ana');
const PROJECT = { name: 'NOME', path: path.resolve('/dev/nome') };

function files(map: Record<string, string>) {
  const abs = new Map(Object.entries(map).map(([k, v]) => [path.resolve(k), v]));
  return (file: string) => abs.get(path.resolve(file)) ?? null;
}

describe('safeTarget', () => {
  it('mostra só o programa, sem pasta nem argumentos', () => {
    expect(
      safeTarget({ command: 'C:\\Programas\\node\\npx.cmd', args: ['--token', 'segredo'], env: { K: 'x' } }),
    ).toEqual({
      transport: 'stdio',
      target: 'npx.cmd',
    });
  });

  it('endereço sem parâmetros nem credenciais', () => {
    expect(
      safeTarget({ type: 'http', url: 'https://user:senha@mcp.exemplo.com/v1/sse?token=abc', headers: { A: 'b' } }),
    ).toEqual({
      transport: 'http',
      target: 'https://mcp.exemplo.com/v1/sse',
    });
    expect(safeTarget({ url: 'não é endereço' })).toEqual({ transport: 'http', target: '(endereço inválido)' });
  });

  it('tipo desconhecido', () => {
    expect(safeTarget({ type: 'ws' })).toEqual({ transport: 'outro', target: 'ws' });
  });
});

describe('samePath', () => {
  it('ignora barra e caixa', () => {
    expect(samePath('C:/Dev/Nome', 'c:\\dev\\nome')).toBe(true);
    expect(samePath('C:/Dev/Nome', 'C:/Dev/Outro')).toBe(false);
  });
});

describe('readDeclaredExtensions', () => {
  const read = files({
    [path.join(HOME, '.claude.json')]: JSON.stringify({
      mcpServers: { geral: { command: '/usr/bin/uvx', args: ['x'] } },
      projects: {
        [PROJECT.path.replace(/\\/g, '/')]: { mcpServers: { local1: { type: 'sse', url: 'https://a.com/sse' } } },
        [path.resolve('/dev/outro')]: { mcpServers: { naoMostrar: { command: 'x' } } },
      },
    }),
    [path.join(PROJECT.path, '.mcp.json')]:
      '\uFEFF' + JSON.stringify({ mcpServers: { do_projeto: { command: 'node' } } }),
    [path.join(HOME, '.claude', 'settings.json')]: JSON.stringify({ enabledPlugins: { 'a@m': true, 'b@m': false } }),
    [path.join(HOME, '.claude', 'plugins', 'installed_plugins.json')]: JSON.stringify({
      version: 2,
      plugins: {
        'b@m': [{ version: '2.0.0', installPath: path.join(HOME, 'plug', 'b') }],
        'a@m': [{ version: '1.0.0', installPath: path.join(HOME, 'plug', 'a') }],
      },
    }),
    [path.join(HOME, 'plug', 'a', '.mcp.json')]: JSON.stringify({ mcpServers: { servidorA: { command: 'a' } } }),
  });

  it('junta usuário, local do projeto e projeto, só dos projetos do Nexus', () => {
    const r = readDeclaredExtensions({ home: HOME, projects: [PROJECT], readFile: read });
    expect(r.problems).toEqual([]);
    expect(r.servers.map((s) => [s.name, s.scope, s.origin])).toEqual([
      ['geral', 'user', ''],
      ['local1', 'local', 'NOME'],
      ['do_projeto', 'project', 'NOME'],
    ]);
  });

  it('lista plugins em ordem, com o estado ligado e os servidores que trazem', () => {
    const r = readDeclaredExtensions({ home: HOME, projects: [PROJECT], readFile: read });
    expect(r.plugins).toEqual([
      { id: 'a@m', version: '1.0.0', enabled: true, servers: ['servidorA'] },
      { id: 'b@m', version: '2.0.0', enabled: false, servers: [] },
    ]);
  });

  it('arquivo ausente não é problema; JSON inválido avisa sem derrubar o resto', () => {
    const broken = files({
      [path.join(HOME, '.claude.json')]: '{ quebrado',
      [path.join(PROJECT.path, '.mcp.json')]: JSON.stringify({ mcpServers: { ok: { command: 'x' } } }),
    });
    const r = readDeclaredExtensions({ home: HOME, projects: [PROJECT], readFile: broken });
    expect(r.problems).toEqual(['~/.claude.json não pôde ser lido (JSON inválido).']);
    expect(r.servers.map((s) => s.name)).toEqual(['ok']);
    expect(readDeclaredExtensions({ home: HOME, projects: [], readFile: () => null })).toEqual({
      servers: [],
      plugins: [],
      problems: [],
    });
  });
});
