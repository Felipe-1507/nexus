import { expect, test } from '@playwright/test';
import { launchApp, removeUserData } from './launch';

// Rascunho do campo de mensagem sobrevive a recarregar a tela (Etapa 15.11). Não envia nada: não gasta cota.

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'precisa do Claude Code instalado; rode com NEXUS_LIVE_TESTS=1');

  test('o texto ainda não enviado volta depois de recarregar e some quando é apagado', async () => {
    const { app, page, userData } = await launchApp(undefined, { claude: 'real' });
    try {
      await page.evaluate(() =>
        window.nexus.invoke('workspaces:create', { name: 'Rascunho', color: 'violet', icon: 'layers' }),
      );
      await page.reload();
      await page.getByTestId('chat-view').waitFor();
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await expect(box).toBeEnabled({ timeout: 30_000 });
      await box.fill('mensagem pela metade');
      await page.reload();
      await page.getByTestId('chat-view').waitFor();
      await expect(box).toHaveValue('mensagem pela metade', { timeout: 30_000 });
      await box.fill('');
      await page.reload();
      await page.getByTestId('chat-view').waitFor();
      await expect(box).toHaveValue('');
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});
