import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createConsoleOpener, installCommand, LAUNCHER, loginCommand } from './claude-setup';

function fakeSpawn(result: { exit: number } | { error: string }) {
  const child = new EventEmitter();
  const fn = vi.fn(() => {
    queueMicrotask(() =>
      'exit' in result ? child.emit('exit', result.exit) : child.emit('error', new Error(result.error)),
    );
    return child;
  });
  return { fn: fn as unknown as typeof spawn, calls: fn.mock.calls as unknown[][] };
}

describe('configuração do Claude Code', () => {
  it('instala pelo instalador oficial, numa janela do PowerShell que espera o usuário fechar', () => {
    const cmd = installCommand();
    expect(cmd.file).toBe('powershell.exe');
    expect(cmd.args.slice(0, 2)).toEqual(['-NoProfile', '-EncodedCommand']);
    const script = Buffer.from(cmd.args[2]!, 'base64').toString('utf16le');
    expect(script).toContain('irm https://claude.ai/install.ps1 | iex');
    expect(script).toContain('Read-Host');
  });

  it('o login é o do próprio Claude Code, chamado pelo executável detectado', () => {
    expect(loginCommand('C:\\Users\\x\\.local\\bin\\claude.exe')).toEqual({
      file: 'C:\\Users\\x\\.local\\bin\\claude.exe',
      args: ['auth', 'login'],
    });
  });

  it('pede a janela ao Windows por um lançador oculto, sem shell, com caminho e argumentos por variável', async () => {
    const { fn, calls } = fakeSpawn({ exit: 0 });
    const open = createConsoleOpener({ PATH: 'C:\\bin', ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_SSE_PORT: '1' }, fn);
    const odd = "C:\\Users\\Ana D'Ávila & Cia\\.local\\bin\\claude.exe";
    await open({ file: odd, args: ['auth', 'login'] });
    const [file, args, options] = calls[0] as [string, string[], Record<string, unknown>];
    expect(file).toBe('powershell.exe');
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', LAUNCHER]);
    expect(options).toMatchObject({ shell: false, stdio: 'ignore', windowsHide: true });
    // O caminho com aspas e & não entra no script, só na variável; e o ambiente sai limpo.
    expect(options.env).toEqual({ PATH: 'C:\\bin', NEXUS_CONSOLE_FILE: odd, NEXUS_CONSOLE_ARGS: 'auth login' });
  });

  it('recusa argumentos com espaço (seriam quebrados na linha de comando)', async () => {
    const { fn, calls } = fakeSpawn({ exit: 0 });
    await expect(createConsoleOpener({}, fn)({ file: 'x.exe', args: ['a b'] })).rejects.toThrow('inválidos');
    expect(calls).toHaveLength(0);
  });

  it('falha do lançador vira erro', async () => {
    await expect(createConsoleOpener({}, fakeSpawn({ exit: 1 }).fn)({ file: 'x.exe', args: ['y'] })).rejects.toThrow(
      'código 1',
    );
    await expect(
      createConsoleOpener({}, fakeSpawn({ error: 'ENOENT' }).fn)({ file: 'x.exe', args: ['y'] }),
    ).rejects.toThrow('ENOENT');
  });
});
