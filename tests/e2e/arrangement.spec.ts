import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData, setWindowSize } from './launch';

// Etapa 14.3: Código na navegação e escolha livre do que fica no centro e no painel direito.

async function createWorkspace(page: Page, name: string): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; rootPath: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Navegação principal' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Painel lateral' });
const main = (page: Page) => page.getByRole('main');
const tabs = (page: Page) => panel(page).getByRole('tab').allInnerTexts();

test('Código fica entre Chat e Galáxia e as abas do painel acompanham o que está no centro', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await setWindowSize(app, 1440, 900);
    const ws = await createWorkspace(page, 'Arranjo');
    fs.writeFileSync(path.join(ws.rootPath, 'exemplo.js'), 'export const resposta = 42;\n');
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    // Ordem na navegação: Chat, Código, Galáxia.
    const items = await nav(page).locator('button[aria-current], button:has(svg)').allInnerTexts();
    const order = ['Chat', 'Código', 'Galáxia'].map((n) => items.findIndex((t) => t.trim() === n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // Chat no centro: o painel oferece Nota, Código e Galáxia.
    expect((await tabs(page)).map((t) => t.trim())).toEqual(['Nota', 'Código', 'Galáxia']);

    // Código nunca abre sozinho: o painel espera um arquivo.
    await nav(page).getByRole('button', { name: 'Código', exact: true }).click();
    await expect(main(page)).toContainText('Nenhum arquivo aberto');
    await expect(page.getByTestId('code-file')).toHaveCount(0);
    expect((await tabs(page)).map((t) => t.trim())).toEqual(['Nota', 'Galáxia']);

    // Clicar num arquivo da árvore abre o código no centro, sem mexer no painel direito.
    const tree = page.getByTestId('folder-section').getByRole('tree', { name: 'Arquivos' });
    await tree.getByRole('button', { name: 'exemplo.js', exact: true }).click();
    await expect(main(page).getByTestId('code-file').locator('.monaco-editor .view-lines')).toContainText(
      'resposta = 42',
    );
    await expect(panel(page).getByTestId('code-file')).toHaveCount(0);

    // Galáxia no centro: o painel oferece Nota e Código; o arquivo aberto continua lá.
    await nav(page).getByRole('button', { name: 'Galáxia', exact: true }).click();
    await expect(page.getByTestId('galaxy-canvas')).toHaveCount(1);
    expect((await tabs(page)).map((t) => t.trim())).toEqual(['Nota', 'Código']);
    await panel(page).getByRole('tab', { name: 'Código' }).click();
    await expect(panel(page).getByTestId('code-file')).toContainText('exemplo.js');

    // Voltando ao chat, o arquivo segue na aba Código do painel; Galáxia volta para a lista.
    await nav(page).getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByTestId('chat-view')).toBeVisible();
    expect((await tabs(page)).map((t) => t.trim())).toEqual(['Nota', 'Código', 'Galáxia']);
    await expect(panel(page).getByRole('tab', { name: 'Código' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByTestId('code-file')).toContainText('exemplo.js');

    // Código no centro com a aba Código ativa no painel: o painel cai para Nota (sem duplicar o código).
    await nav(page).getByRole('button', { name: 'Código', exact: true }).click();
    await expect(panel(page).getByRole('tab', { name: 'Nota' })).toHaveAttribute('aria-selected', 'true');
    await expect(main(page).getByTestId('code-file')).toBeVisible();
    await expect(page.getByTestId('code-file')).toHaveCount(1);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('divisores da barra lateral: arrastar muda a altura das seções, o teclado também, fica salvo e duplo clique restaura', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await setWindowSize(app, 1440, 900);
    const ws = await createWorkspace(page, 'Divisores');
    for (const name of ['Alfa', 'Beta', 'Gama']) {
      await page.evaluate(
        ([id, n]) => window.nexus.invoke('projects:create', { kind: 'managed', workspaceId: id, name: n }),
        [ws.id, name],
      );
    }
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    const height = async (id: string) => (await page.getByTestId(`section-${id}`).boundingBox())!.height;
    const divider = (n: 1 | 2 | 3) =>
      page.getByRole('separator', {
        name: [
          'Redimensionar entre Workspaces e Projetos',
          'Redimensionar entre Projetos e Conversas',
          'Redimensionar entre Conversas e Pastas',
        ][n - 1]!,
      });

    const before = {
      projects: await height('projects'),
      conversations: await height('conversations'),
      folders: await height('folders'),
    };
    // As três seções têm espaço de verdade (antes, Pastas ficava espremida).
    expect(before.folders).toBeGreaterThan(100);

    // Arrastar o divisor entre Projetos e Conversas 40 px para baixo: Projetos cresce, Conversas encolhe.
    const box = (await divider(2).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await height('projects')) - before.projects)).toBe(40);
    expect(Math.round(before.conversations - (await height('conversations')))).toBe(40);

    // Arrastar o último divisor para baixo tira espaço das Pastas.
    const foldersBefore = await height('folders');
    const box3 = (await divider(3).boundingBox())!;
    await page.mouse.move(box3.x + box3.width / 2, box3.y);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width / 2, box3.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(foldersBefore - (await height('folders')))).toBe(30);

    // Teclado: seta para cima no divisor 2 devolve 16 px.
    const projectsAfter = await height('projects');
    await divider(2).focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => Math.round(projectsAfter - (await height('projects')))).toBe(16);

    // Nunca passa do mínimo: arrastar muito para cima deixa Projetos com 56 px.
    const box2 = (await divider(2).boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y - 600, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(await height('projects'))).toBe(56);

    // Fica salvo ao reiniciar a tela.
    await page.reload();
    await page.getByTestId('chat-view').waitFor();
    await expect.poll(async () => Math.round(await height('projects'))).toBe(56);

    // Duplo clique devolve as seções vizinhas ao tamanho automático.
    const handle = (await divider(2).boundingBox())!;
    await page.mouse.dblclick(handle.x + handle.width / 2, handle.y);
    await expect.poll(async () => Math.round(await height('projects'))).toBeGreaterThan(100);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
