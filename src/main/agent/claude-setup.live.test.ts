import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConsoleOpener } from './claude-setup';

// Abre uma janela de console de verdade (com um comando inofensivo, por ~2 segundos). Não instala nada nem consome
// tokens, mas aparece na tela, por isso só roda com NEXUS_LIVE_TESTS=1.
describe.runIf(process.env.NEXUS_LIVE_TESTS === '1')('janela de console real', () => {
  it('o Windows abre a janela e o comando roda inteiro', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-console-'));
    const out = path.join(dir, 'ok.txt');
    const script = `Write-Host 'Teste do Nexus'; 'ok' | Out-File -Encoding ascii -FilePath '${out}'; Start-Sleep 2`;
    try {
      await createConsoleOpener(process.env)({
        file: 'powershell.exe',
        args: ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      });
      await expect.poll(() => fs.existsSync(out), { timeout: 15_000 }).toBe(true);
      expect(fs.readFileSync(out, 'utf8').trim()).toBe('ok');
    } finally {
      await new Promise((r) => setTimeout(r, 2_500));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
