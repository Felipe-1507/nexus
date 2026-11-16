import { expect, test } from '@playwright/test';
import { launchApp, removeUserData } from './launch';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

      // Texto digitado e anexo escolhido sobrevivem a sair do chat e voltar (sem enviar nada).
      await box.fill('escrevendo com anexo');
      await page.getByLabel('Escolher arquivos para anexar').setInputFiles({
        name: 'print.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PNG_1X1, 'base64'),
      });
      const chips = page.getByTestId('composer-attachments').getByTestId('attachment');
      await expect(chips).toHaveCount(1);
      const nav = page.getByRole('navigation', { name: 'Navegação principal' });
      await nav.getByRole('button', { name: 'Galáxia' }).click();
      await expect(page.getByTestId('galaxy-view')).toBeVisible();
      await nav.getByRole('button', { name: 'Chat' }).click();
      await expect(box).toHaveValue('escrevendo com anexo');
      await expect(chips).toHaveCount(1);
      await page.reload();
      await page.getByTestId('chat-view').waitFor();
      await expect(box).toHaveValue('escrevendo com anexo', { timeout: 30_000 });
      await expect(chips).toHaveCount(1);

      // Cada projeto tem o seu rascunho: ir para outro projeto e voltar não perde nem mistura nada.
      const ws = (await page.evaluate(() => window.nexus.invoke('workspaces:list', undefined))) as {
        ok: true;
        data: { workspaces: Array<{ id: string }> };
      };
      await page.evaluate(
        (id) => window.nexus.invoke('projects:create', { kind: 'managed', workspaceId: id, name: 'Site' }),
        ws.data.workspaces[0]!.id,
      );
      await page.reload();
      await page.getByTestId('chat-view').waitFor();
      const projects = page.getByRole('list', { name: 'Lista de projetos' });
      await projects.getByRole('button', { name: 'Site', exact: true }).click();
      await expect(box).toHaveValue('', { timeout: 30_000 });
      await expect(chips).toHaveCount(0);
      await box.fill('texto do projeto Site');
      await projects.getByRole('button', { name: 'Geral', exact: true }).click();
      await expect(box).toHaveValue('escrevendo com anexo');
      await expect(chips).toHaveCount(1);
      await projects.getByRole('button', { name: 'Site', exact: true }).click();
      await expect(box).toHaveValue('texto do projeto Site');
      await expect(chips).toHaveCount(0);
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});

test('rascunho com anexo volta ao reabrir a conversa e ao voltar de outra tela, sem misturar projetos', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = (await page.evaluate(() =>
      window.nexus.invoke('workspaces:create', { name: 'Rascunho', color: 'violet', icon: 'layers' }),
    )) as { ok: true; data: { id: string } };
    const wsId = ws.data.id;
    const saved = (await page.evaluate(
      (a) => window.nexus.invoke('attachments:save', a),
      { workspaceId: wsId, name: 'print.png', mime: 'image/png', data: PNG_1X1 } as never,
    )) as { ok: true; data: { id: string; name: string; mime: string; size: number } };
    // Rascunhos gravados como o campo de mensagem os grava: um no Workspace, outro de um projeto qualquer.
    await page.evaluate(
      (d) => {
        localStorage.setItem(d.workspaceKey, d.workspaceDraft);
        localStorage.setItem(d.projectKey, JSON.stringify({ text: 'texto do projeto', attachments: [] }));
      },
      {
        workspaceKey: `nexus.draft2.new:${wsId}:`,
        projectKey: `nexus.draft2.new:${wsId}:projeto-x`,
        workspaceDraft: JSON.stringify({ text: 'pela metade', attachments: [saved.data] }),
      },
    );
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    const box = page.getByRole('textbox', { name: 'Mensagem' });
    const chips = page.getByTestId('composer-attachments').getByTestId('attachment');
    await expect(box).toHaveValue('pela metade');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('print.png');
    await expect(chips.first().locator('img')).toBeVisible();

    // Sai para a galáxia e volta ao chat: tudo continua lá.
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await nav.getByRole('button', { name: 'Galáxia' }).click();
    await expect(page.getByTestId('galaxy-view')).toBeVisible();
    await nav.getByRole('button', { name: 'Chat' }).click();
    await expect(box).toHaveValue('pela metade');
    await expect(chips).toHaveCount(1);

    // O rascunho de um projeto não aparece no do Workspace.
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nexus.draft2.')));
    expect(stored).toHaveLength(2);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
