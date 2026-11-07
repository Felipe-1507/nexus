import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { contentRoot, launchApp, removeUserData, tempUserData } from './launch';

// Aparência personalizável (Etapa 11.3): variação do tema escuro e cor de destaque.

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('variação do escuro e cor de destaque mudam na hora, persistem e já abrem aplicadas', async () => {
  const userData = tempUserData();
  // Tema escuro fixo, para o teste não depender do tema do Windows.
  fs.writeFileSync(
    path.join(userData, 'preferences.json'),
    JSON.stringify({
      version: 1,
      dataRoot: contentRoot(userData),
      theme: 'dark',
      privacyAcceptedAt: new Date().toISOString(),
    }),
  );
  let { app, page } = await launchApp(userData);
  try {
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const variants = page.getByRole('radiogroup', { name: 'Tema escuro' });
    await expect(variants.getByRole('radio', { name: 'Padrão' })).toHaveAttribute('aria-checked', 'true');
    const defaultBg = await cssVar(page, '--bg');

    await variants.getByRole('radio', { name: 'Azul-noite' }).click();
    await expect.poll(() => cssVar(page, '--bg')).toBe('#070d1a');
    // A janela (fundo e barra de título nativa) acompanha.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor()))
      .toBe('#070D1A');

    await page.getByRole('radiogroup', { name: 'Cor de destaque' }).getByRole('radio', { name: 'Azul' }).click();
    await expect.poll(() => cssVar(page, '--accent')).toBe('#4f8cff');

    await expect
      .poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8')))
      .toMatchObject({ darkVariant: 'azul-noite', accent: '#4f8cff' });

    // Ao reabrir, as cores já vêm na própria página (sem piscar a cor padrão antes).
    await app.close();
    ({ app, page } = await launchApp(userData));
    const served = await page.evaluate(async () => (await fetch('nexus://app/index.html')).text());
    expect(served).toMatch(/<style id="nexus-appearance">[^<]*--bg: #070d1a;/);
    expect(await cssVar(page, '--bg')).toBe('#070d1a');
    expect(await cssVar(page, '--accent')).toBe('#4f8cff');

    // Voltar ao padrão.
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    await page.getByRole('radiogroup', { name: 'Tema escuro' }).getByRole('radio', { name: 'Padrão' }).click();
    await page.getByRole('radiogroup', { name: 'Cor de destaque' }).getByRole('radio', { name: 'Padrão' }).click();
    await expect.poll(() => cssVar(page, '--bg')).toBe(defaultBg);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('cor de destaque inválida é recusada pelo main', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const r = await page.evaluate(() => window.nexus.invoke('appearance:set', { accent: 'url(javascript:x)' }));
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
