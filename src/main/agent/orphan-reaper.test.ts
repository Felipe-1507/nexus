import { describe, expect, it, vi } from 'vitest';
import { findOrphans, reapOrphans, type ProcessInfo } from './orphan-reaper';

const claude = (pid: number, parentPid: number): ProcessInfo => ({
  pid,
  parentPid,
  commandLine: `C:\\claude.exe --output-format stream-json --system-prompt-snapshot off`,
});

describe('processos órfãos do Claude Code', () => {
  const all: ProcessInfo[] = [
    { pid: 10, parentPid: 1, commandLine: 'Nexus.exe' },
    claude(20, 10), // pai vivo: não é órfão
    claude(30, 999), // pai sumiu: órfão
    { pid: 40, parentPid: 999, commandLine: 'C:\\claude.exe --resume x' }, // sem a marca: de outra origem
    { pid: 50, parentPid: 999, commandLine: 'node --system-prompt-snapshot' }, // marca, mas não é o claude
  ];

  it('acha só os do Nexus sem pai vivo', () => {
    expect(findOrphans(all, 1).map((p) => p.pid)).toEqual([30]);
  });

  it('nunca escolhe o próprio processo', () => {
    expect(findOrphans(all, 30)).toEqual([]);
  });

  it('encerra os órfãos e segue mesmo se um falhar', async () => {
    const kill = vi.fn(async (pid: number) => {
      if (pid === 30) throw new Error('acesso negado');
    });
    const more = [...all, claude(31, 999)];
    const done = await reapOrphans({ list: async () => more, kill }, 1);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(done).toEqual([31]);
  });

  it('não lança se a listagem falhar', async () => {
    const done = await reapOrphans({ list: async () => Promise.reject(new Error('x')), kill: vi.fn() });
    expect(done).toEqual([]);
  });
});
