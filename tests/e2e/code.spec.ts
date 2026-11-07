import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Visualizador de código (Etapa 9).

async function createWorkspace(page: Page, name: string): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; rootPath: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Painel lateral' });

test('árvore da pasta, abrir, editar e salvar arquivo, conflito e caminhos recusados', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Código');
    fs.mkdirSync(path.join(ws.rootPath, 'src'));
    fs.mkdirSync(path.join(ws.rootPath, 'node_modules'));
    const file = path.join(ws.rootPath, 'src', 'calculo.js');
    fs.writeFileSync(file, 'export const taxa = 1;\n');
    fs.writeFileSync(path.join(ws.rootPath, 'logo.bin'), Buffer.from([0, 1, 2, 3]));

    await page.reload();
    await page.getByTestId('chat-view').waitFor();
    // As pastas ficam na barra lateral, abaixo das conversas; o painel de código só mostra o arquivo escolhido.
    const tree = page.getByTestId('folder-section').getByRole('tree', { name: 'Arquivos' });
    await expect(tree.getByRole('button', { name: 'src', exact: true })).toBeVisible();
    await expect(tree.getByRole('button', { name: 'node_modules', exact: true })).toHaveCount(0);

    // Arquivo binário não é mostrado.
    await tree.getByRole('button', { name: 'logo.bin', exact: true }).click();
    await expect(page.getByTestId('code-file')).toContainText('Arquivo binário');
    await page.getByRole('button', { name: 'Fechar arquivo' }).click();
    await expect(panel(page)).toContainText('Nenhum arquivo aberto');

    // Pasta abre sob demanda; o arquivo abre no Monaco, só leitura até "Editar".
    await tree.getByRole('button', { name: 'src', exact: true }).click();
    await tree.getByRole('button', { name: 'calculo.js', exact: true }).click();
    const view = page.getByTestId('code-file');
    await expect(view.locator('.monaco-editor .view-lines')).toContainText('export const taxa = 1;');

    await view.getByRole('button', { name: 'Editar arquivo' }).click();
    await view.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// revisado');
    await expect(view.getByTestId('code-status')).toHaveText('Não salvo');
    await page.keyboard.press('Control+S');
    await expect(view.getByTestId('code-status')).toHaveText('Salvo');
    expect(fs.readFileSync(file, 'utf8')).toContain('// revisado');

    // Arquivo alterado por fora: salvar não sobrescreve.
    fs.writeFileSync(file, 'export const taxa = 2;\n');
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(file, later, later);
    await page.keyboard.type(' de novo');
    await page.keyboard.press('Control+S');
    await expect(view.getByRole('alert')).toContainText('O arquivo mudou fora do editor');
    expect(fs.readFileSync(file, 'utf8')).toBe('export const taxa = 2;\n');
    await view.getByRole('button', { name: 'Recarregar' }).click();
    await expect(view.locator('.monaco-editor .view-lines')).toContainText('export const taxa = 2;');

    // Caminhos fora da pasta do escopo são recusados.
    const scope = { workspaceId: ws.id, projectId: null };
    const outside = await page.evaluate(
      (s) => window.nexus.invoke('code:read', { ...s, path: '../../preferences.json' }),
      scope,
    );
    expect(outside).toMatchObject({ ok: false });
    const write = await page.evaluate(
      (s) => window.nexus.invoke('code:write', { ...s, path: '../fora.txt', content: 'x', expectedMtimeMs: 0 }),
      scope,
    );
    expect(write).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(path.dirname(ws.rootPath), 'fora.txt'))).toBe(false);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('colar arquivos e pastas copiados do Explorer, soltar nelas, e excluir (vai para a Lixeira)', async () => {
  const { app, page, userData } = await launchApp();
  const origem = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-origem-'));
  try {
    const ws = await createWorkspace(page, 'Colar');
    fs.mkdirSync(path.join(ws.rootPath, 'src'));
    // Origem fora do Nexus, como no Explorer.
    fs.mkdirSync(path.join(origem, 'pasta-copiada', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(origem, 'relatorio.txt'), 'relatório');
    fs.writeFileSync(path.join(origem, 'pasta-copiada', 'sub', 'dentro.txt'), 'dentro');
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    const section = page.getByTestId('folder-section');
    const tree = section.getByRole('tree', { name: 'Arquivos' });
    const entry = (name: string) => tree.getByRole('button', { name, exact: true });

    // Copia no Windows (Ctrl+C no Explorer), seleciona a pasta "src" e cola.
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Set-Clipboard -Path '${path.join(origem, 'relatorio.txt')}','${path.join(origem, 'pasta-copiada')}'`,
    ]);
    await entry('src').click();
    await page.keyboard.press('Control+V');
    await expect(section.getByTestId('tree-notice')).toHaveText('2 itens colados em src.');
    expect(fs.readFileSync(path.join(ws.rootPath, 'src', 'relatorio.txt'), 'utf8')).toBe('relatório');
    expect(fs.existsSync(path.join(ws.rootPath, 'src', 'pasta-copiada', 'sub', 'dentro.txt'))).toBe(true);
    // Aparecem na árvore sem recarregar, e o original continua onde estava.
    await expect(entry('relatorio.txt')).toBeVisible();
    await expect(entry('pasta-copiada')).toBeVisible();
    expect(fs.existsSync(path.join(origem, 'relatorio.txt'))).toBe(true);

    // Colar de novo não sobrescreve.
    fs.writeFileSync(path.join(ws.rootPath, 'src', 'relatorio.txt'), 'editado aqui');
    await page.keyboard.press('Control+V');
    await expect(section.getByTestId('tree-notice')).toContainText('2 itens colados');
    await expect(entry('relatorio - cópia.txt')).toBeVisible();
    expect(fs.readFileSync(path.join(ws.rootPath, 'src', 'relatorio.txt'), 'utf8')).toBe('editado aqui');

    // Excluir pede confirmação, e cancelar não apaga nada.
    await entry('relatorio - cópia.txt').click();
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('dialog', { name: /Mover para a Lixeira: relatorio - cópia\.txt/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    expect(fs.existsSync(path.join(ws.rootPath, 'src', 'relatorio - cópia.txt'))).toBe(true);

    // Confirmar manda para a Lixeira: some do disco e da árvore.
    await tree.getByRole('button', { name: 'Excluir relatorio - cópia.txt', exact: true }).click({ force: true });
    await page
      .getByRole('dialog', { name: /Mover para a Lixeira/ })
      .getByRole('button', { name: 'Mover para a Lixeira' })
      .click();
    await expect(section.getByTestId('tree-notice')).toContainText('foi para a Lixeira');
    await expect(entry('relatorio - cópia.txt')).toHaveCount(0);
    expect(fs.existsSync(path.join(ws.rootPath, 'src', 'relatorio - cópia.txt'))).toBe(false);

    // Caminhos fora da pasta do escopo são recusados no main.
    const scope = { workspaceId: ws.id, projectId: null };
    const fora = await page.evaluate(
      (s) => window.nexus.invoke('code:delete', { ...s, path: '../../preferences.json' }),
      scope,
    );
    expect(fora).toMatchObject({ ok: false });
    const raiz = await page.evaluate((s) => window.nexus.invoke('code:delete', { ...s, path: '.' }), scope);
    expect(raiz).toMatchObject({ ok: false });
  } finally {
    await app.close();
    removeUserData(userData);
    fs.rmSync(origem, { recursive: true, force: true });
  }
});

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 180_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  test('o cartão do arquivo alterado abre o diff da resposta', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const ws = await createWorkspace(page, 'Diff');
      fs.writeFileSync(path.join(ws.rootPath, 'config.txt'), 'porta=8080\nmodo=teste\n');
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await expect(box).toBeEnabled({ timeout: 30_000 });
      await box.fill(
        'No arquivo config.txt, troque porta=8080 por porta=9090 usando a ferramenta Edit. Responda só: feito.',
      );
      await box.press('Enter');

      const files = page.getByTestId('message-assistant').last().getByTestId('changed-files');
      await expect(files.getByRole('button', { name: 'config.txt' })).toBeVisible({ timeout: 120_000 });
      await files.getByRole('button', { name: 'config.txt' }).click();

      const diff = page.getByTestId('code-diff');
      await expect(diff).toContainText('Editado pelo Claude');
      await expect(diff.locator('.monaco-diff-editor')).toContainText('porta=9090');
      await expect(diff.locator('.monaco-diff-editor')).toContainText('porta=8080');

      await diff.getByRole('button', { name: 'Ver arquivo atual' }).click();
      await expect(page.getByTestId('code-file').locator('.monaco-editor .view-lines')).toContainText('porta=9090');
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});
