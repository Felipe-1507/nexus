import { describe, expect, it, vi } from 'vitest';
import { resolveAppPaths } from '../../platform/paths';
import { openKnownPath } from './app';

const paths = resolveAppPaths('C:\\dados', 'C:\\Users\\x', null);

describe('openKnownPath', () => {
  it('abre só pastas conhecidas, resolvidas no main', async () => {
    const shellOpen = vi.fn(async () => '');
    await openKnownPath('logs', paths, shellOpen);
    await openKnownPath('userData', paths, shellOpen);
    expect(shellOpen.mock.calls).toEqual([[paths.logs], [paths.userData]]);
  });

  it('transforma falha do shell em erro de domínio', async () => {
    await expect(openKnownPath('logs', paths, async () => 'pasta não existe')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
