import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBranding } from '../../scripts/branding.mjs';

// App empacotado de verdade (Etapa 10): fuses, ASAR e o SDK carregado de dentro do pacote.
//
// O app instalado ignora NEXUS_USER_DATA_DIR e as outras variáveis de teste, e os fuses bloqueiam o --inspect que
// o Playwright usa com o Electron. Por isso o .exe é aberto com --user-data-dir (dados numa pasta temporária) e a
// página é controlada pela porta de depuração do Chromium.

const exe = path.resolve('release', 'win-unpacked', `${loadBranding().productName}.exe`);

interface Packaged {
  child: ChildProcess;
  browser: Browser;
  page: Page;
  userData: string;
}

async function launchPackaged(): Promise<Packaged> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-packaged-'));
  fs.writeFileSync(
    path.join(userData, 'preferences.json'),
    JSON.stringify({ version: 1, dataRoot: path.join(userData, 'conteudo'), theme: 'system', privacyAcceptedAt: null }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE',
    ),
  ) as Record<string, string>;
  const child = spawn(exe, [`--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    env,
    stdio: 'ignore',
  });

  // Antes de qualquer ação, confirma que o app está mesmo usando a pasta temporária (e não os dados reais).
  const log = path.join(userData, 'logs', 'main.log');
  await expect.poll(() => fs.existsSync(log), { timeout: 15_000 }).toBe(true);

  // Porta 0: o Chromium escolhe uma livre e a anota em DevToolsActivePort (uma porta fixa já ficou presa por um
  // processo morto e derrubou o teste).
  const portFile = path.join(userData, 'DevToolsActivePort');
  await expect.poll(() => fs.existsSync(portFile), { timeout: 15_000 }).toBe(true);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);

  let browser: Browser | undefined;
  await expect
    .poll(
      async () => {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
        return browser !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const context = browser!.contexts()[0]!;
  let page: Page | undefined;
  await expect
    .poll(() => (page = context.pages().find((p) => p.url().startsWith('nexus://app'))), { timeout: 15_000 })
    .toBeDefined();
  await page!.getByTestId('chat-view').waitFor();
  return { child, browser: browser!, page: page!, userData };
}

async function close({ child, browser, userData }: Packaged): Promise<string> {
  await browser.close().catch(() => undefined);
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
  const log = fs.readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8');
  // Os processos auxiliares do Chromium (GPU, interface) ainda podem segurar arquivos por um instante.
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  return log;
}

test.skip(!fs.existsSync(exe), 'gere o pacote antes: npm run dist');

test('o app empacotado abre, mostra o aviso de privacidade, encontra o Claude Code e não registra erros', async () => {
  const app = await launchPackaged();
  let log: string | undefined;
  try {
    const { page, userData } = app;
    const notice = page.getByRole('dialog', { name: 'Antes de começar' });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Entendi' }).click();
    await expect(notice).toBeHidden();

    const info = await page.evaluate(() => window.nexus.invoke('app:getInfo'));
    expect(info).toMatchObject({ ok: true, data: { paths: { userData } } });
    // Sem o Claude Code embutido no SDK: o app usa (e encontra) o instalado no computador.
    const status = await page.evaluate(() => window.nexus.invoke('claude:status', { refresh: false }));
    expect(status).toMatchObject({ ok: true, data: { cli: { state: 'found' } } });

    // A galáxia (WebGL e o pacote do Three.js) abre com a política de segurança do app instalado.
    await page.evaluate(() =>
      window.nexus.invoke('workspaces:create', { name: 'Pacote', color: 'violet', icon: 'layers' }),
    );
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Galáxia' })
      .click();
    await expect(page.getByTestId('galaxy-canvas')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('galaxy-view')).toContainText('Sua galáxia está vazia');
  } finally {
    log = await close(app);
  }
  expect(log).not.toMatch(/\[(error|warn)\]/);
});

test('conversa de verdade a partir do pacote', async () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  const app = await launchPackaged();
  try {
    const { page } = app;
    await page.getByRole('dialog', { name: 'Antes de começar' }).getByRole('button', { name: 'Entendi' }).click();
    const ws = (await page.evaluate(() =>
      window.nexus.invoke('workspaces:create', { name: 'Pacote', color: 'violet', icon: 'layers' }),
    )) as { ok: true; data: { id: string; rootPath: string } };
    // O app instalado não lê NEXUS_CLAUDE_MODEL: o modelo barato vem do padrão do Workspace.
    await page.evaluate(
      (id) => window.nexus.invoke('workspaces:setDefaultModel', { id, model: 'haiku', effort: null }),
      ws.data.id,
    );
    fs.writeFileSync(path.join(ws.data.rootPath, 'leia.txt'), 'codigo=azul\n');
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    const box = page.getByRole('textbox', { name: 'Mensagem' });
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await box.fill('Leia o arquivo leia.txt e responda só com o valor de codigo.');
    await box.press('Enter');
    await expect(page.getByTestId('message-assistant').last()).toContainText(/azul/i, { timeout: 120_000 });
  } finally {
    await close(app);
  }
});
