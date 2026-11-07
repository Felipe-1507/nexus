import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { runFile } from '../platform/run';
import { detectClaude } from './cli-detector';

// Usa o Claude Code real desta máquina. `auth status` e `--version` não consomem tokens, mas dependem da
// instalação local, por isso só rodam com NEXUS_LIVE_TESTS=1.
describe.runIf(process.env.NEXUS_LIVE_TESTS === '1')('Claude Code real', () => {
  it('encontra o CLI instalado e a conta conectada', async () => {
    const status = await detectClaude({
      platform: process.platform,
      env: process.env,
      homedir: os.homedir(),
      run: runFile,
      exists: (f) => fs.existsSync(f),
      readText: (f) => fs.readFileSync(f, 'utf8'),
    });
    expect(status.cli).toMatchObject({ state: 'found' });
    expect(status.auth).toMatchObject({ state: 'logged_in' });
    expect(status.ready).toBe(true);
  }, 40_000);
});
