import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData, tempUserData } from './launch';

// Permissões e execução (Etapa 6).

async function createWorkspace(page: Page, name: string): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; rootPath: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Mensagem' });
const lastAnswer = (page: Page) => page.getByTestId('message-assistant').last();

test('modo de permissão do Workspace: Auto por padrão e persiste após reiniciar', async () => {
  const userData = tempUserData();
  let { app, page } = await launchApp(userData);
  try {
    await createWorkspace(page, 'Permissões');
    await page.getByRole('button', { name: 'Abrir Permissões: instruções e detalhes' }).click();
    const section = page.getByTestId('permissions-section');
    await expect(section.getByRole('radio', { name: /Auto/ })).toHaveAttribute('aria-checked', 'true');
    await expect(section).toContainText('Nenhuma decisão registrada ainda.');

    await section.getByRole('radio', { name: /Perguntar/ }).click();
    await expect(section.getByRole('radio', { name: /Perguntar/ })).toHaveAttribute('aria-checked', 'true');

    await app.close();
    ({ app, page } = await launchApp(userData));
    await page.getByRole('button', { name: 'Abrir Permissões: instruções e detalhes' }).click();
    await expect(page.getByTestId('permissions-section').getByRole('radio', { name: /Perguntar/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('pedidos inexistentes e arquivos fora do Workspace são recusados', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Seguro');
    const respond = await page.evaluate(() =>
      window.nexus.invoke('permissions:respond', { requestId: 'inventado', decision: 'allow_once' }),
    );
    expect(respond).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const outside = await page.evaluate(
      (id) => window.nexus.invoke('files:reveal', { workspaceId: id, path: 'C:\\Windows\\win.ini' }),
      ws.id,
    );
    expect(outside).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  test('modo Auto: cria o arquivo sem perguntar e o "Desfazer" remove', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const ws = await createWorkspace(page, 'Auto');
      await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
      await composer(page).fill('Crie o arquivo ola.txt com o conteúdo "oi". Responda só: feito.');
      await composer(page).press('Enter');

      await expect(lastAnswer(page)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('permission-card')).toHaveCount(0);
      const file = path.join(ws.rootPath, 'ola.txt');
      expect(fs.readFileSync(file, 'utf8').trim()).toBe('oi');

      const files = lastAnswer(page).getByTestId('changed-files');
      await expect(files.getByRole('button', { name: 'ola.txt' })).toBeVisible();
      await files.getByRole('button', { name: 'Desfazer' }).click();
      const dialog = page.getByRole('dialog', { name: 'Desfazer as alterações?' });
      await expect(dialog).toContainText('ola.txt');
      await dialog.getByRole('button', { name: 'Desfazer' }).click();

      await expect(files).toContainText('Alterações desfeitas');
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });

  test('o Claude pergunta com opções, o usuário escolhe e a resposta volta para ele', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      await createWorkspace(page, 'Pergunta');
      await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
      await composer(page).fill(
        'Use a ferramenta AskUserQuestion para me perguntar qual cor eu prefiro, com as opções "Azul" e "Verde". ' +
          'Depois responda só com a cor que eu escolhi.',
      );
      await composer(page).press('Enter');
      const card = page.getByTestId('question-card');
      await expect(card).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('permission-card')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Responder' })).toBeDisabled();
      await card.getByRole('radio', { name: /Verde/ }).check();
      await card.getByRole('button', { name: 'Responder' }).click();
      await expect(lastAnswer(page)).toContainText(/verde/i, { timeout: 120_000 });
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });

  test('modo Perguntar: negar não cria, permitir cria, e tudo fica registrado', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const ws = await createWorkspace(page, 'Perguntar');
      await page.evaluate((id) => window.nexus.invoke('workspaces:setPermissionMode', { id, mode: 'ask' }), ws.id);
      await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
      const file = path.join(ws.rootPath, 'b.txt');

      await composer(page).fill('Crie o arquivo b.txt com o conteúdo "b". Se for negado, responda só: negado.');
      await composer(page).press('Enter');
      const card = page.getByTestId('permission-card');
      await expect(card).toContainText('criar b.txt', { timeout: 120_000 });
      await card.getByRole('button', { name: 'Negar' }).click();
      await expect(page.getByTestId('message-assistant')).toHaveCount(1, { timeout: 120_000 });
      expect(fs.existsSync(file)).toBe(false);

      await composer(page).fill('Tente de novo criar b.txt com o conteúdo "b". Responda só: feito.');
      await composer(page).press('Enter');
      await expect(card).toContainText('criar b.txt', { timeout: 120_000 });
      await card.getByRole('button', { name: 'Permitir', exact: true }).click();
      await expect(page.getByTestId('message-assistant')).toHaveCount(2, { timeout: 120_000 });
      expect(fs.existsSync(file)).toBe(true);

      await page.getByRole('button', { name: 'Abrir Perguntar: instruções e detalhes' }).click();
      const history = page.getByRole('list', { name: 'Histórico de permissões' });
      await expect(history.getByRole('listitem')).toHaveCount(2);
      await expect(history).toContainText('Negado');
      await expect(history).toContainText('Permitido');
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});
