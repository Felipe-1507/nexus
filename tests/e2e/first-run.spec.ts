import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Primeira execução e tratamento de erros (Etapa 10).

test('aviso de privacidade na primeira execução: só fecha confirmando e não volta depois', async () => {
  const first = await launchApp(undefined, { firstRun: true });
  const { userData } = first;
  let { app, page } = first;
  try {
    const notice = page.getByRole('dialog', { name: 'Antes de começar' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Anthropic');

    await page.keyboard.press('Escape');
    await expect(notice).toBeVisible();

    await notice.getByRole('button', { name: 'Entendi' }).click();
    await expect(notice).toBeHidden();
    const prefs = JSON.parse(fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8'));
    expect(prefs.privacyAcceptedAt).toEqual(expect.any(String));

    await app.close();
    ({ app, page } = await launchApp(userData));
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const settings = page.getByTestId('settings-view');
    await expect(settings.getByRole('heading', { name: 'Privacidade' })).toBeVisible();
    await expect(settings).toContainText('Aviso confirmado em');
    await expect(page.getByRole('dialog', { name: 'Antes de começar' })).toHaveCount(0);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('erros da interface vão para o log do app', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('falha proposital na janela');
      });
      void Promise.reject(new Error('falha proposital em promise'));
    });
    const logFile = path.join(userData, 'logs', 'main.log');
    await expect
      .poll(() => fs.readFileSync(logFile, 'utf8'))
      .toContain('Erro na interface (window): falha proposital na janela');
    expect(fs.readFileSync(logFile, 'utf8')).toContain('Erro na interface (promise): falha proposital em promise');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
