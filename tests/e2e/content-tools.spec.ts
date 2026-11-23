import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData, tempUserData } from './launch';

// Busca no conteúdo das notas e dos projetos, painel de extensões (MCP e plugins) e backup manual.

async function setup(page: Page, name: string) {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; knowledgeDir: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const search = (page: Page) => page.getByRole('dialog', { name: 'Buscar' });

test('buscar no texto das notas e nos arquivos de um projeto', async () => {
  const userData = tempUserData();
  const projectDir = path.join(userData, 'meu-projeto');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'src', 'baixa.ts'),
    'linha 1\nexport const baixaEmLote = 1; // Conferência física\n',
  );
  fs.mkdirSync(path.join(projectDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'node_modules', 'x.js'), 'conferência física escondida');
  const { app, page } = await launchApp(userData);
  try {
    const ws = await setup(page, 'Trabalho');
    fs.writeFileSync(
      path.join(ws.knowledgeDir, 'Fechamento.md'),
      '# Fechamento\n\nO boleto vence no dia 5 e a Conferência Física vem antes.\n',
    );
    fs.writeFileSync(path.join(ws.knowledgeDir, 'Outra.md'), '# Outra\n\nNada relacionado.\n');
    const created = (await page.evaluate(
      ([id, dir]) =>
        window.nexus.invoke('projects:create', {
          kind: 'linked',
          workspaceId: id!,
          name: 'NOME',
          path: dir!,
          trustConfig: false,
        }),
      [ws.id, projectDir],
    )) as { ok: boolean };
    expect(created.ok).toBe(true);

    await page.keyboard.press('Control+Shift+F');
    const box = search(page).getByRole('searchbox', { name: 'Texto da busca' });

    // Notas: acha pelo texto, sem diferenciar acento e caixa, e abre a nota no painel lateral.
    await search(page).getByTestId('search-tab-notes').click();
    await box.fill('conferencia fisica');
    const results = search(page).getByTestId('search-results');
    await expect(results).toContainText('Fechamento');
    await expect(results).not.toContainText('Outra');
    await expect(search(page).getByTestId('search-status')).toHaveText('1 resultado');
    await results.getByRole('button', { name: /Fechamento/ }).click();
    await expect(search(page)).toHaveCount(0);
    await expect(page.getByTestId('note-editor')).toContainText('Conferência Física');

    // Arquivos do projeto: acha no conteúdo (com a linha) e ignora node_modules.
    await page.keyboard.press('Control+Shift+F');
    await search(page).getByTestId('search-tab-files').click();
    await search(page).getByRole('searchbox', { name: 'Texto da busca' }).fill('conferencia fisica');
    const files = search(page).getByTestId('search-results');
    await expect(files).toContainText('baixa.ts');
    await expect(files).toContainText('linha 2');
    await expect(files).not.toContainText('node_modules');
    await files.getByRole('button', { name: /baixa\.ts/ }).click();
    await expect(search(page)).toHaveCount(0);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('extensões: lista MCP do projeto sem mostrar segredos', async () => {
  const userData = tempUserData();
  const projectDir = path.join(userData, 'proj');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        banco: {
          command: 'C:\\ferramentas\\banco-mcp.exe',
          args: ['--senha', 'SEGREDO123'],
          env: { TOKEN: 'SEGREDO456' },
        },
      },
    }),
  );
  const { app, page } = await launchApp(userData);
  try {
    const ws = await setup(page, 'Trabalho');
    await page.evaluate(
      ([id, dir]) =>
        window.nexus.invoke('projects:create', {
          kind: 'linked',
          workspaceId: id!,
          name: 'NOME',
          path: dir!,
          trustConfig: true,
        }),
      [ws.id, projectDir],
    );
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const section = page.getByTestId('extensions-section');
    const servers = section.getByTestId('extensions-servers');
    await expect(servers).toContainText('banco');
    await expect(servers).toContainText('Projeto · NOME · stdio · banco-mcp.exe');
    await expect(section).not.toContainText('SEGREDO');
    // Sem Claude Code nestes testes, verificar explica o motivo em vez de falhar calado.
    await section.getByTestId('extensions-probe').click();
    await expect(section.getByRole('alert')).toContainText('Claude Code não está disponível');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('backup manual cria um .zip com banco, preferências e notas', async () => {
  const userData = tempUserData();
  const target = path.join(userData, 'saida-backup.zip');
  const { app, page } = await launchApp(userData, { env: { NEXUS_BACKUP_TARGET: target } });
  try {
    const ws = await setup(page, 'Trabalho');
    fs.writeFileSync(path.join(ws.knowledgeDir, 'Importante.md'), '# Importante\n\nnão pode se perder\n');
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    await page.getByTestId('backup-export').click();
    await expect(page.getByTestId('backup-done')).toContainText('saida-backup.zip');

    const list = execFileSync('tar', ['-tf', target], { encoding: 'utf8' }).replace(/\\/g, '/');
    expect(list).toContain('nexus.db');
    expect(list).toContain('preferences.json');
    expect(list).toContain('LEIA-ME.txt');
    expect(list).toContain('Importante.md');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('atualização do Nexus: pasta com versão nova mostra o aviso; pasta sem manifesto mostra o erro', async () => {
  const userData = tempUserData();
  const feed = path.join(userData, 'versoes');
  fs.mkdirSync(feed, { recursive: true });
  fs.writeFileSync(path.join(feed, 'Nexus-9.9.9-instalador.exe'), 'x');
  fs.writeFileSync(
    path.join(feed, 'nexus-update.json'),
    JSON.stringify({ version: '9.9.9', file: 'Nexus-9.9.9-instalador.exe', sha512: 'a'.repeat(128) }),
  );
  const { app, page } = await launchApp(userData);
  try {
    await setup(page, 'Trabalho');
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const section = page.getByTestId('app-update-section');
    // Desligada por padrão: nada de aviso.
    await expect(page.getByTestId('app-update-notice')).toHaveCount(0);

    const source = section.getByTestId('app-update-source');
    await source.fill(path.join(userData, 'nao-existe'));
    await source.blur();
    await expect(section.getByTestId('app-update-status')).toContainText('Não há nexus-update.json');

    await source.fill(feed);
    await source.blur();
    await expect(section.getByTestId('app-update-status')).toContainText('Versão 9.9.9 disponível');
    await expect(section.getByTestId('app-update-install')).toBeVisible();
    await expect(page.getByTestId('app-update-notice')).toContainText('Nexus 9.9.9 disponível');

    // Endereço HTTP de fora é recusado antes de gravar.
    await source.fill('http://exemplo.com/versoes');
    await source.blur();
    await expect(section.getByRole('alert')).toContainText('HTTPS');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
