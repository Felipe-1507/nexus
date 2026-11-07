import { expect, test, type Page } from '@playwright/test';
import { launchApp, removeUserData } from './launch';

// Seletor de modelo (Etapa 6.1).

async function createWorkspace(page: Page, name: string): Promise<string> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data.id;
}

test('sem Claude Code o seletor fica desativado; modelo inválido é recusado', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const id = await createWorkspace(page, 'Modelos');
    await expect(page.getByTestId('model-picker')).toBeDisabled();

    const bad = await page.evaluate(
      (wsId) => window.nexus.invoke('workspaces:setDefaultModel', { id: wsId, model: 'haiku; rm -rf /', effort: null }),
      id,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    const ok = await page.evaluate(
      (wsId) => window.nexus.invoke('workspaces:setDefaultModel', { id: wsId, model: 'haiku', effort: 'low' }),
      id,
    );
    expect(ok).toMatchObject({ ok: true, data: { defaultModel: 'haiku', defaultEffort: 'low' } });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('escolher Haiku com esforço baixo e confirmar qual modelo respondeu', async () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.setTimeout(180_000);
  // Sem NEXUS_CLAUDE_MODEL: quem decide o modelo é o seletor.
  const { app, page, userData } = await launchApp(undefined, { claude: 'real' });
  try {
    await createWorkspace(page, 'Modelo real');
    const picker = page.getByTestId('model-picker');
    await expect(picker).toBeEnabled({ timeout: 30_000 });
    await picker.click();
    const dialog = page.getByRole('dialog', { name: 'Escolher modelo' });
    await dialog.getByRole('option', { name: /Haiku 5\.5/ }).click({ timeout: 60_000 });
    await dialog.getByRole('radio', { name: 'Baixo' }).click();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveAccessibleName('Modelo: Haiku 5.5, esforço Baixo');

    const box = page.getByRole('textbox', { name: 'Mensagem' });
    await box.fill('Responda só: ok');
    await box.press('Enter');
    const answer = page.getByTestId('message-assistant').last();
    await expect(answer).toContainText('ok', { timeout: 120_000 });
    await answer.getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(answer.getByTestId('message-model')).toContainText('claude-haiku-5-5');

    // A escolha ficou na conversa.
    await expect(picker).toHaveAccessibleName('Modelo: Haiku 5.5, esforço Baixo');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
