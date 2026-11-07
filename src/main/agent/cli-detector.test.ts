import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Run, RunResult } from '../platform/run';
import { childEnv } from './child-env';
import {
  compareVersions,
  detectClaude,
  locateCli,
  parseAuthStatus,
  resolveNpmShim,
  type DetectorDeps,
} from './cli-detector';

const NPM_DIR = 'C:\\Users\\u\\AppData\\Roaming\\npm';
const SHIM = path.join(NPM_DIR, 'claude.cmd');
const EXE = path.join(NPM_DIR, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
// Conteúdo real do atalho gerado pelo npm (Etapa 0).
const SHIM_CONTENT = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
`;

const ok = (stdout: string): RunResult => ({ ok: true, stdout, stderr: '' });
const fail = (reason: 'not_found' | 'timeout' | 'exit', stdout = '', code: number | null = 1): RunResult => ({
  ok: false,
  reason,
  code,
  stdout,
  stderr: '',
});

const LOGGED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'eu@exemplo.com.br',
  orgName: 'Organização',
  subscriptionType: 'pro',
});

function deps(overrides: Partial<DetectorDeps> & { responses?: Record<string, RunResult> } = {}): DetectorDeps {
  const responses: Record<string, RunResult> = {
    'where claude': ok(`${path.join(NPM_DIR, 'claude')}\r\n${SHIM}\r\n`),
    [`${EXE} --version`]: ok('2.1.295 (Claude Code)\n'),
    [`${EXE} auth status --json`]: ok(LOGGED_IN),
    ...overrides.responses,
  };
  const run: Run = vi.fn(async (file, args) => responses[[file, ...args].join(' ')] ?? fail('not_found'));
  const files = new Set([SHIM, EXE]);
  return {
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', PATH: 'x' },
    homedir: 'C:\\Users\\u',
    run,
    exists: (f) => files.has(f),
    readText: (f) => {
      if (f === SHIM) return SHIM_CONTENT;
      throw new Error('ENOENT');
    },
    now: () => '2026-10-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('localizar o CLI', () => {
  it('resolve o atalho .cmd do npm até o claude.exe real', async () => {
    expect(resolveNpmShim(SHIM, () => SHIM_CONTENT)).toBe(EXE);
    expect(await locateCli(deps())).toEqual({ path: EXE, source: 'path' });
  });

  it('cai na instalação nativa quando não está no PATH', async () => {
    const native = 'C:\\Users\\u\\.local\\bin\\claude.exe';
    const d = deps({ responses: { 'where claude': fail('exit') }, exists: (f) => f === native });
    expect(await locateCli(d)).toEqual({ path: native, source: 'native' });
  });

  it('cai na pasta global do npm quando o PATH não tem o claude', async () => {
    const d = deps({ responses: { 'where claude': fail('exit') }, exists: (f) => f === EXE });
    expect(await locateCli(d)).toEqual({ path: EXE, source: 'npm' });
  });

  it('usa o caminho fixo quando informado, sem procurar', async () => {
    const d = deps({ overridePath: 'D:\\nao-existe\\claude.exe' });
    expect(await locateCli(d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
  });
});

describe('diagnóstico completo', () => {
  it('pronto: versão e conta conectada', async () => {
    const status = await detectClaude(deps());
    expect(status).toEqual({
      checkedAt: '2026-10-30T00:00:00.000Z',
      cli: { state: 'found', path: EXE, version: '2.1.295', source: 'path' },
      auth: {
        state: 'logged_in',
        method: 'claude.ai',
        provider: 'firstParty',
        email: 'eu@exemplo.com.br',
        organization: 'Organização',
        plan: 'pro',
      },
      warnings: [],
      ready: true,
    });
  });

  it('não instalado', async () => {
    const d = deps({ responses: { 'where claude': fail('exit') }, exists: () => false });
    const status = await detectClaude(d);
    expect(status.cli).toEqual({ state: 'not_found' });
    expect(status.ready).toBe(false);
  });

  it('conta desconectada, mesmo com código de saída diferente de zero', async () => {
    const d = deps({ responses: { [`${EXE} auth status --json`]: fail('exit', '{"loggedIn": false}') } });
    const status = await detectClaude(d);
    expect(status.auth).toEqual({ state: 'logged_out' });
    expect(status.ready).toBe(false);
  });

  it('CLI que não responde vira erro, sem travar', async () => {
    const d = deps({ responses: { [`${EXE} --version`]: fail('timeout', '', null) } });
    const status = await detectClaude(d);
    expect(status.cli).toEqual({ state: 'error', path: EXE, message: 'O Claude Code não respondeu a tempo.' });
    expect(status.ready).toBe(false);
  });

  it('avisa sobre ANTHROPIC_API_KEY e versão antiga', async () => {
    const d = deps({
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', ANTHROPIC_API_KEY: 'sk-ant-x' },
      responses: { [`${EXE} --version`]: ok('1.0.80 (Claude Code)') },
    });
    const status = await detectClaude(d);
    expect(status.warnings).toHaveLength(2);
    expect(status.warnings[0]).toMatch(/ANTHROPIC_API_KEY/);
    expect(status.warnings[1]).toMatch(/1\.0\.80/);
  });

  it('nunca repassa a chave de API nem variáveis de sessão do Claude ao processo', async () => {
    const d = deps({
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', ANTHROPIC_API_KEY: 'sk', CLAUDE_CODE_ENTRYPOINT: 'x' },
    });
    await detectClaude(d);
    const calls = vi.mocked(d.run).mock.calls.filter(([file]) => file === EXE);
    expect(calls.length).toBe(2);
    for (const [, , { env }] of calls) {
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    }
  });
});

describe('utilitários', () => {
  it('interpreta respostas inesperadas do auth status', () => {
    expect(parseAuthStatus('não é json')).toMatchObject({ state: 'unknown' });
    expect(parseAuthStatus('{"foo":1}')).toMatchObject({ state: 'unknown' });
  });

  it('compara versões numericamente', () => {
    expect(compareVersions('2.1.295', '2.1.0')).toBe(1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(compareVersions('1.0.80', '2.1.0')).toBe(-1);
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0);
  });

  it('limpa o ambiente do processo filho', () => {
    expect(
      childEnv({ PATH: 'p', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_X: 'y', ELECTRON_RUN_AS_NODE: '1' }),
    ).toEqual({ PATH: 'p' });
  });
});
