import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathStatus } from '../../fs/path-status';
import { inspectProjectConfig } from './project-config';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proj-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content: unknown) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
}

describe('inspectProjectConfig', () => {
  it('pasta sem configurações não tem riscos nem impressão digital', async () => {
    expect(await inspectProjectConfig(dir)).toEqual({ risks: [], fingerprint: null });
  });

  it('configuração inofensiva gera impressão digital, mas nenhum risco', async () => {
    write('.claude/settings.json', { model: 'opus' });
    const r = await inspectProjectConfig(dir);
    expect(r.risks).toEqual([]);
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detecta o que executa código ou libera permissões', async () => {
    write('.claude/settings.json', {
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] },
      apiKeyHelper: 'get-key.sh',
      statusLine: { type: 'command', command: 'y' },
      env: { FOO: '1' },
    });
    write('.claude/settings.local.json', { permissions: { allow: ['Bash(npm:*)', 'WebFetch'] } });
    write('.mcp.json', { mcpServers: { db: { command: 'z' } } });
    const { risks } = await inspectProjectConfig(dir);
    expect(risks).toHaveLength(6);
    expect(risks.join('\n')).toMatch(/Hooks/);
    expect(risks.join('\n')).toMatch(/2 regra\(s\) de permissão/);
    expect(risks.join('\n')).toMatch(/\.mcp\.json/);
  });

  it('a impressão digital muda quando o arquivo muda', async () => {
    write('.claude/settings.json', { hooks: { Stop: [] }, model: 'a' });
    const a = await inspectProjectConfig(dir);
    write('.claude/settings.json', { hooks: { Stop: [] }, model: 'b' });
    const b = await inspectProjectConfig(dir);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('JSON inválido também pede confirmação', async () => {
    write('.claude/settings.json', '{ inválido');
    expect((await inspectProjectConfig(dir)).risks[0]).toMatch(/JSON inválido/);
  });
});

describe('pathStatus', () => {
  it('distingue pasta, arquivo e caminho inexistente', async () => {
    write('a.txt', 'x');
    expect(await pathStatus(dir)).toEqual({ status: 'ok', isDirectory: true });
    expect(await pathStatus(path.join(dir, 'a.txt'))).toEqual({ status: 'ok', isDirectory: false });
    expect(await pathStatus(path.join(dir, 'nao-existe'))).toEqual({ status: 'missing', isDirectory: false });
  });
});
