import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Avisos de atualização do Claude Code e de modelo novo (Etapa 15.7). Usa o Claude Code real, mas não gasta cota.

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'precisa do Claude Code instalado; rode com NEXUS_LIVE_TESTS=1');
  const options = { claude: 'real' as const };

  test('compara a versão instalada com a mais nova e mostra o aviso de atualização', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const check = (await page.evaluate(() => window.nexus.invoke('claude:updateCheck', { refresh: true }))) as {
        ok: true;
        data: { current: string; latest: string | null; available: boolean };
      };
      expect(check.data.current).toMatch(/^\d+\.\d+\.\d+$/);
      const notice = page.getByTestId('claude-update-notice');
      if (check.data.latest && check.data.available) {
        await page.reload();
        await expect(notice).toContainText(check.data.latest, { timeout: 30_000 });
        await notice.getByRole('button', { name: 'Dispensar aviso de atualização' }).click();
        await expect(notice).toHaveCount(0);
        await page.reload();
        await page.getByTestId('chat-view').waitFor();
        await expect(notice).toHaveCount(0);
      }
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });

  test('modelo novo: no primeiro uso não avisa; com uma lista antiga avisa e dispensar grava a lista atual', async () => {
    // Primeiro uso: a lista atual vira "já vista" e não há aviso.
    let run = await launchApp(undefined, options);
    const userData = run.userData;
    try {
      await expect
        .poll(
          async () => ((await run.page.evaluate(() => window.nexus.invoke('models:news'))) as { data: unknown[] }).data,
        )
        .toEqual([]);
      await expect(run.page.getByTestId('new-model-notice')).toHaveCount(0);
      await run.app.close();

      // Uma lista vista de antes (sem o Haiku 5.5 e o Opus 4.8): os dois aparecem como novos.
      const file = path.join(userData, 'preferences.json');
      const prefs = JSON.parse(fs.readFileSync(file, 'utf8')) as { seenModels: string[] };
      prefs.seenModels = prefs.seenModels.filter((v) => v !== 'claude-opus-4-8' && v !== 'haiku');
      fs.writeFileSync(file, JSON.stringify(prefs));
      run = await launchApp(userData, options);
      const notice = run.page.getByTestId('new-model-notice');
      await expect(notice).toContainText('Opus 4.8', { timeout: 30_000 });
      await expect(notice).toContainText('Haiku 5.5');
      await run.page.screenshot({ path: path.join('test-results', 'aviso-modelo-novo.png') });

      await notice.getByRole('button', { name: /dispensar aviso de modelo novo/ }).click();
      await expect(notice).toHaveCount(0);
      await run.app.close();
      run = await launchApp(userData, options);
      await run.page.getByTestId('chat-view').waitFor();
      expect(((await run.page.evaluate(() => window.nexus.invoke('models:news'))) as { data: unknown[] }).data).toEqual(
        [],
      );
    } finally {
      await run.app.close().catch(() => undefined);
      removeUserData(userData);
    }
  });
});
