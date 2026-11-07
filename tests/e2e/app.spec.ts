import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadBranding } from '../../scripts/branding.mjs';
import { launchApp, removeUserData, tempUserData } from './launch';

// Fundação e segurança da janela (Etapa 1).
let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  ({ app, page, userData } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
  removeUserData(userData);
});

test('abre a janela com o título do app', async () => {
  await expect(page).toHaveTitle(loadBranding().productName);
});

test('cria o banco e o log na pasta de dados', async () => {
  expect(fs.existsSync(path.join(userData, 'nexus.db'))).toBe(true);
  expect(fs.existsSync(path.join(userData, 'logs', 'main.log'))).toBe(true);
});

test('renderer não tem acesso ao Node e só enxerga a ponte mínima', async () => {
  const probe = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridgeKeys: Object.keys(window.nexus),
  }));
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', bridgeKeys: ['invoke', 'on', 'pathsForFiles'] });
});

test('canal fora da lista é recusado', async () => {
  const result = await page.evaluate(() => window.nexus.invoke('fs:apagarTudo' as never));
  expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
});

test('abrir pasta só aceita as pastas conhecidas', async () => {
  const result = await page.evaluate(() => window.nexus.invoke('app:openPath', 'C:\\Windows'));
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

test('CSP é enviado e bloqueia script inline', async () => {
  // page.evaluate passa por cima do CSP, então o teste injeta um <script> como faria um conteúdo malicioso.
  const probe = await page.evaluate(async () => {
    const csp = (await fetch('nexus://app/index.html')).headers.get('content-security-policy');
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.body.appendChild(s);
    return { csp, inlineRan: (window as unknown as { __inlineRan?: boolean }).__inlineRan === true };
  });
  expect(probe.csp).toContain("default-src 'none'");
  expect(probe.csp).toContain("script-src 'self';"); // em produção, sem 'unsafe-inline'
  expect(probe.inlineRan).toBe(false);
});

test('a janela não navega para fora do app', async () => {
  const before = page.url();
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
});

test('servidor de arquivos do app recusa sair da pasta do renderer', async () => {
  const status = await page.evaluate(async () => (await fetch('nexus://app/..%2f..%2fpackage.json')).status);
  expect([403, 404]).toContain(status);
});

test('abertura animada: janelinha no centro antes, e depois só a janela principal', async () => {
  const userData = tempUserData();
  fs.writeFileSync(
    path.join(userData, 'preferences.json'),
    JSON.stringify({
      version: 1,
      dataRoot: path.join(userData, 'conteudo'),
      theme: 'system',
      privacyAcceptedAt: new Date().toISOString(),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE',
    ),
  ) as Record<string, string>;
  const startedAt = Date.now();
  const splashApp = await electron.launch({
    args: ['.'],
    env: { ...env, NEXUS_USER_DATA_DIR: userData, NEXUS_CLAUDE_CLI: path.join(userData, 'sem-claude', 'claude.exe') },
  });
  try {
    // A primeira janela é a abertura: quadrada, sem moldura, tocando o vídeo da marca (sem JavaScript).
    const first = await splashApp.firstWindow();
    expect(first.url()).toMatch(/splash\.html$/);
    const video = first.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', 'intro.webm');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.error)).toBe(true);
    const size = await splashApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getSize()));
    expect(size.some(([w, h]) => w === 420 && h === 420)).toBe(true);

    // A janela principal aparece e a abertura some.
    await expect
      .poll(
        () =>
          splashApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible() })),
          ),
        { timeout: 20_000 },
      )
      .toEqual([{ url: expect.stringContaining('index.html'), visible: true }]);
    // O app só aparece depois do vídeo inteiro (4 s).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_800);
  } finally {
    await splashApp.close();
    removeUserData(userData);
  }
});
