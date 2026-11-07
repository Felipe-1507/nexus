import { describe, expect, it, vi } from 'vitest';
import type { ClaudeStatus } from '@shared/claude';
import { ClaudeStatusService } from './claude-status';

const status = (checkedAt: string): ClaudeStatus => ({
  checkedAt,
  cli: { state: 'not_found' },
  auth: { state: 'unknown', message: 'x' },
  warnings: [],
  ready: false,
});

describe('ClaudeStatusService', () => {
  it('reaproveita o diagnóstico e só refaz quando pedido', async () => {
    const detect = vi.fn(async () => status(String(detect.mock.calls.length)));
    const service = new ClaudeStatusService(detect);
    expect((await service.get()).checkedAt).toBe('1');
    expect((await service.get()).checkedAt).toBe('1');
    expect((await service.get(true)).checkedAt).toBe('2');
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('não guarda falhas no cache', async () => {
    const detect = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(status('ok'));
    const service = new ClaudeStatusService(detect);
    await expect(service.get()).rejects.toThrow('boom');
    expect((await service.get()).checkedAt).toBe('ok');
  });
});
