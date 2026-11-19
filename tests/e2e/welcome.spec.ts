import { expect, test, type Page } from '@playwright/test';
import { launchApp, removeUserData, tempUserData } from './launch';

// Tela de boas-vindas: primeira abertura do dia, com resumo local (sem Claude nestes testes).

const ON = { env: { NEXUS_NO_WELCOME: '0' } };

async function createWorkspace(page: Page, name: string): Promise<string> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data.id;
}

test('aparece na primeira abertura do dia, vai embora com Continuar e não volta no mesmo dia', async () => {
  const userData = tempUserData();
  let { app, page } = await launchApp(userData, ON);
  try {
    // Sem Workspace não há o que mostrar; ao criar o primeiro (e recarregar), a tela abre.
    await createWorkspace(page, 'Trabalho');
    const welcome = page.getByTestId('welcome');
    await expect(welcome).toBeVisible();
    await expect(page.getByTestId('welcome-greeting')).toHaveText(/^(Bom dia|Boa tarde|Boa noite)/);
    await expect(welcome).toContainText(/Uma ótima|Um ótimo/);
    // Sem Claude e sem nada alterado: o resumo é local e diz que o dia foi tranquilo.
    await expect(page.getByTestId('welcome-empty')).toBeVisible();
    await expect(page.getByTestId('welcome-source')).toContainText('sem IA');
    // A galáxia fica por trás.
    await expect(page.getByTestId('galaxy-view')).toBeVisible();

    await page.getByTestId('welcome-continue').click();
    await expect(welcome).toHaveCount(0);
    // Volta para onde o app estava.
    await expect(page.getByTestId('chat-view')).toBeVisible();

    await app.close();
    ({ app, page } = await launchApp(userData, ON));
    const due = (await page.evaluate(() => window.nexus.invoke('welcome:due', { force: false }))) as {
      ok: true;
      data: { due: boolean };
    };
    expect(due.data.due).toBe(false);
    await expect(page.getByTestId('welcome')).toHaveCount(0);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('Esc fecha a tela', async () => {
  const { app, page, userData } = await launchApp(undefined, ON);
  try {
    await createWorkspace(page, 'Trabalho');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    await expect(page.getByTestId('chat-view')).toBeVisible();
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('desligada nas configurações, não aparece; "Ver agora" mostra o que mudou', async () => {
  const { app, page, userData } = await launchApp(undefined, ON);
  try {
    const workspaceId = await createWorkspace(page, 'Trabalho');
    await page.getByTestId('welcome-continue').click();
    await page.evaluate(
      (id) => window.nexus.invoke('knowledge:create', { workspaceId: id, folder: '', title: 'Fechamento do mês' }),
      workspaceId,
    );

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const enabled = page.getByTestId('welcome-enabled');
    await expect(enabled).toBeChecked();
    await enabled.uncheck();
    await expect(enabled).not.toBeChecked();
    await page.getByTestId('welcome-ai').uncheck();
    await page.getByTestId('welcome-name').fill('Ana');
    await page.getByTestId('welcome-name').blur();

    await page.getByTestId('welcome-preview').click();
    await expect(page.getByTestId('welcome-greeting')).toHaveText(/, Ana\.$/);
    const item = page.getByTestId('welcome-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Notas gerais');
    await expect(item).toContainText('Fechamento do mês');

    // Fechar volta para as Configurações, de onde "Ver agora" saiu.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-view')).toBeVisible();
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
