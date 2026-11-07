import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Detecção do Claude Code (Etapa 4).

test('sem Claude Code: passo a passo para conectar no chat, com instalar e entrar', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const indicator = page.getByTestId('claude-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'error');
    await expect(indicator).toHaveText('Claude não conectado');

    const connect = page.getByTestId('chat-view').getByTestId('connect-claude');
    await expect(connect).toContainText('Conecte o Claude para conversar');
    await expect(connect.getByRole('button', { name: 'Entrar com a minha conta' })).toBeDisabled();

    // O teste não instala nada: o main só registra no log o console que abriria.
    await connect.getByRole('button', { name: 'Instalar', exact: true }).click();
    await expect(connect).toContainText('o Nexus percebe sozinho quando terminar');
    const log = path.join(userData, 'logs', 'main.log');
    await expect.poll(() => fs.readFileSync(log, 'utf8')).toContain('Console simulado');
    const encoded = /'([A-Za-z0-9+/=]{40,})'/.exec(fs.readFileSync(log, 'utf8'))?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain('irm https://claude.ai/install.ps1 | iex');

    // Entrar exige o Claude Code instalado, mesmo chamando o canal direto.
    const login = await page.evaluate(() => window.nexus.invoke('claude:login'));
    expect(login).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

    await connect.getByRole('button', { name: 'Detalhes' }).click();
    const panel = page.getByTestId('claude-status');
    await expect(panel).toContainText('Não encontrado');
    await expect(panel.getByRole('button', { name: 'Instalar o Claude Code' })).toBeVisible();
    await panel.getByRole('button', { name: 'Verificar novamente' }).click();
    await expect(panel).toContainText('Não encontrado');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('com o Claude Code desta máquina: versão e conta conectada', async () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'usa a instalação real; rode com NEXUS_LIVE_TESTS=1');
  const { app, page, userData } = await launchApp(undefined, { claude: 'real' });
  try {
    await expect(page.getByTestId('claude-indicator')).toHaveAttribute('data-state', /ok|warning/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('connect-claude')).toHaveCount(0);

    await page.getByTestId('claude-indicator').click();
    const panel = page.getByTestId('claude-status');
    await expect(panel).toContainText(/Claude Code \d+\.\d+\.\d+/);
    await expect(panel).toContainText('@');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
