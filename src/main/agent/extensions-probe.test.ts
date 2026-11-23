import type { McpServerStatus, SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { probeExtensions, toProbe, type ProbeQuery } from './extensions-probe';

const NOW = new Date('2026-11-23T12:00:00Z');

const statuses = [
  { name: 'leve', status: 'connected', source: 'user', tools: [{ name: 'a' }] },
  { name: 'pesado x', status: 'connected', scope: 'project', tools: [{ name: 'b' }, { name: 'c' }] },
  { name: 'quebrado', status: 'failed', error: 'spawn ENOENT' },
] as unknown as McpServerStatus[];

const usage = {
  categories: [
    { id: 'system_prompt', name: 'x', tokens: 3000, kind: 'used' },
    { id: 'mcp_tools', name: 'y', tokens: 9100, kind: 'used' },
    { id: 'free_space', name: 'z', tokens: 900000, kind: 'free' },
  ],
  mcpTools: [
    { name: 'a', serverName: 'leve', tokens: 100 },
    { name: 'b', serverName: 'pesado_x', tokens: 6000 },
    { name: 'c', serverName: 'pesado_x', tokens: 3000 },
    { name: 'd', serverName: 'leve', tokens: 500, isLoaded: false },
  ],
  maxTokens: 1_000_000,
} as unknown as SDKControlGetContextUsageResponse;

describe('toProbe', () => {
  const r = toProbe('Projeto X', statuses, usage, NOW);

  it('soma o peso por servidor (nome normalizado) e ignora ferramentas não carregadas', () => {
    expect(r.servers.map((s) => [s.name, s.tokens, s.tools])).toEqual([
      ['pesado x', 9000, 2],
      ['leve', 100, 1],
      ['quebrado', 0, 0],
    ]);
  });

  it('traz erro, origem e totais do contexto', () => {
    expect(r.servers.find((s) => s.name === 'quebrado')).toMatchObject({ status: 'failed', error: 'spawn ENOENT' });
    expect(r.servers.find((s) => s.name === 'pesado x')?.source).toBe('project');
    expect(r).toMatchObject({ scope: 'Projeto X', mcpTokens: 9100, baseTokens: 12100, maxTokens: 1_000_000 });
  });
});

describe('probeExtensions', () => {
  function fake(over: Partial<ProbeQuery> = {}) {
    const close = vi.fn();
    const query = {
      mcpServerStatus: async () => statuses,
      getContextUsage: async () => usage,
      close,
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      ...over,
    } as unknown as ProbeQuery;
    return { query, close };
  }
  const base = {
    env: {},
    cliPath: 'claude',
    cwd: '.',
    settingSources: ['user'] as const,
    scope: 'Usuário',
    now: () => NOW,
  };

  it('pergunta e sempre fecha o processo', async () => {
    const { query, close } = fake();
    const r = await probeExtensions({ ...base, settingSources: ['user'], createQuery: () => query });
    expect(r.servers).toHaveLength(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it('fecha o processo também quando a pergunta falha', async () => {
    const { query, close } = fake({ mcpServerStatus: async () => Promise.reject(new Error('caiu')) });
    await expect(probeExtensions({ ...base, settingSources: ['user'], createQuery: () => query })).rejects.toThrow(
      'caiu',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
