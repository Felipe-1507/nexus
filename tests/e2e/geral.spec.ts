import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// "Geral" e projetos (Etapa 12.9): o Geral conhece os projetos e trocar de projeto abre a conversa dele.

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 240_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  const composer = (page: Page) => page.getByRole('textbox', { name: 'Mensagem' });
  const projectsList = (page: Page) => page.getByRole('list', { name: 'Lista de projetos' });

  test('o Geral lista os projetos e trocar de projeto abre a última conversa dele', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const ws = (await page.evaluate(() =>
        window.nexus.invoke('workspaces:create', { name: 'Gerente', color: 'violet', icon: 'layers' }),
      )) as { data: { id: string; rootPath: string } };
      const folder = path.join(userData, 'alfa');
      fs.mkdirSync(folder);
      await page.evaluate((a) => window.nexus.invoke('projects:create', a), {
        kind: 'linked',
        workspaceId: ws.data.id,
        name: 'Alfa',
        path: folder,
        trustConfig: false,
      } as never);
      await page.reload();
      await expect(composer(page)).toBeEnabled({ timeout: 30_000 });

      // No Geral, o Claude já sabe quais projetos existem (vem no prompt, sem ferramenta nenhuma).
      await composer(page).fill('Quais projetos existem neste Workspace? Responda só os nomes, sem usar ferramentas.');
      await composer(page).press('Enter');
      await expect(page.getByTestId('message-assistant').last()).toContainText('Alfa', { timeout: 120_000 });

      // No projeto, começa uma conversa nova e responde.
      await projectsList(page).getByRole('button', { name: 'Alfa', exact: true }).click();
      await expect(page.getByTestId('message-user')).toHaveCount(0);
      await composer(page).fill('Responda somente: ok-alfa');
      await composer(page).press('Enter');
      await expect(page.getByTestId('message-assistant').last()).toContainText('ok-alfa', { timeout: 120_000 });

      // Voltar ao Geral abre a conversa dele sozinha, e voltar ao projeto abre a conversa do projeto.
      await projectsList(page).getByRole('button', { name: 'Geral', exact: true }).click();
      await expect(page.getByTestId('message-user').first()).toContainText('Quais projetos existem', {
        timeout: 15_000,
      });
      await projectsList(page).getByRole('button', { name: 'Alfa', exact: true }).click();
      await expect(page.getByTestId('message-user').first()).toContainText('ok-alfa', { timeout: 15_000 });
      await expect(page.getByTestId('message-assistant').last()).toContainText('ok-alfa');
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});
