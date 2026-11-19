import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Segundo plano: fechar a janela não encerra o Nexus; só o menu do ícone, depois de confirmar.

test('fechar a janela esconde o Nexus; o ícone traz de volta; fechar de vez pede confirmação', async () => {
  const { app, page, userData } = await launchApp();
  let exited = false;
  app.on('close', () => (exited = true));
  try {
    const visible = () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return Boolean(w && !w.isDestroyed() && w.isVisible());
      });
    expect(await visible()).toBe(true);

    // O X da janela (e o Alt+F4) só escondem: o app continua rodando e a conversa segue.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect.poll(visible).toBe(false);
    expect(exited).toBe(false);
    expect(await app.evaluate(({ app: a }) => a.isReady())).toBe(true);

    // Abrir o Nexus de novo (ou clicar no ícone) traz a janela de volta, com a tela como estava.
    await app.evaluate(() =>
      (globalThis as never as { __nexusBackground: { showWindow: () => void } }).__nexusBackground.showWindow(),
    );
    await expect.poll(visible).toBe(true);
    await expect(page.getByTestId('chat-view')).toBeVisible();

    // "Fechar o Nexus…" no menu do ícone: recusar mantém tudo como está.
    const ask = (answer: number) =>
      app.evaluate(async ({ dialog }, response) => {
        const asked: string[] = [];
        dialog.showMessageBox = (async (options: { message: string }) => {
          asked.push(options.message);
          return { response, checkboxChecked: false };
        }) as never;
        const g = globalThis as never as { __nexusBackground: { requestQuit: () => Promise<boolean> } };
        return { quit: await g.__nexusBackground.requestQuit(), asked };
      }, answer);
    const declined = await ask(1);
    expect(declined).toEqual({ quit: false, asked: ['Fechar o Nexus de vez?'] });
    expect(exited).toBe(false);
    expect(await visible()).toBe(true);

    // Enquanto roda, a marca de execução existe (é como o próximo início percebe uma queda).
    expect(fs.existsSync(path.join(userData, 'running.json'))).toBe(true);

    // Confirmar encerra de verdade.
    const closed = new Promise<void>((resolve) => app.on('close', () => resolve()));
    void ask(0).catch(() => undefined);
    await closed;
    expect(exited).toBe(true);
    // Fechou direito: a marca foi apagada.
    expect(fs.existsSync(path.join(userData, 'running.json'))).toBe(false);
  } finally {
    if (!exited) await app.close();
    removeUserData(userData);
  }
});

test('fechar de vez termina mesmo com a tela travada (não fica pendurado no Gerenciador de Tarefas)', async () => {
  test.setTimeout(90_000);
  const { app, page, userData } = await launchApp();
  let exited = false;
  const closed = new Promise<void>((resolve) =>
    app.on('close', () => {
      exited = true;
      resolve();
    }),
  );
  try {
    // A tela entra num laço infinito: não responde a nada, nem ao pedido de fechar a janela.
    void page
      .evaluate(() => {
        for (;;);
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
    const started = Date.now();
    void app
      .evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
        const g = globalThis as never as { __nexusBackground: { requestQuit: () => Promise<boolean> } };
        await g.__nexusBackground.requestQuit();
      })
      .catch(() => undefined);
    await Promise.race([closed, new Promise((r) => setTimeout(r, 40_000))]);
    expect(exited).toBe(true);
    expect(Date.now() - started).toBeLessThan(30_000);
  } finally {
    if (!exited) await app.close().catch(() => undefined);
    removeUserData(userData);
  }
});
