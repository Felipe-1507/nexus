import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData, tempUserData } from './launch';

// Projetos e contexto (Etapa 7).

async function createWorkspace(page: Page, name: string): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; rootPath: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const projectList = (page: Page) => page.getByRole('list', { name: 'Lista de projetos' });

async function addLinkedProject(page: Page, folder: string, name?: string) {
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar projeto' });
  await dialog.getByRole('textbox', { name: 'Caminho da pasta' }).fill(folder);
  await dialog.getByRole('textbox', { name: 'Caminho da pasta' }).blur();
  if (name) await dialog.getByRole('textbox', { name: 'Nome do projeto' }).fill(name);
  return dialog;
}

test('projeto gerenciado e vinculado, com aviso de confiança', async () => {
  const userData = tempUserData();
  let { app, page } = await launchApp(userData);
  try {
    const ws = await createWorkspace(page, 'Dev');

    // Pasta nova dentro do Workspace.
    await page.getByRole('button', { name: 'Adicionar projeto' }).click();
    let dialog = page.getByRole('dialog', { name: 'Adicionar projeto' });
    await dialog.getByRole('radio', { name: /Pasta nova/ }).click();
    await dialog.getByRole('textbox', { name: 'Nome do projeto' }).fill('Rascunhos');
    await dialog.getByRole('button', { name: 'Adicionar projeto' }).click();
    await expect(dialog).toBeHidden();
    await expect(projectList(page).getByRole('button', { name: 'Rascunhos', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByTestId('chat-view').getByRole('heading', { level: 1 })).toHaveText('Rascunhos');
    const managed = fs.readdirSync(path.join(ws.rootPath, 'Projetos'));
    expect(managed.some((d) => d.startsWith('rascunhos-'))).toBe(true);

    // Pasta existente com hooks: pede confiança, mas pode entrar sem.
    const repo = path.join(userData, 'repo-site');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{}] } }));
    dialog = await addLinkedProject(page, repo);
    await expect(dialog.getByTestId('trust-warning')).toContainText('Hooks');
    await expect(dialog.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('repo-site');
    await dialog.getByRole('button', { name: 'Adicionar projeto' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Abrir projeto repo-site: instruções e detalhes' }).click();
    const view = page.getByTestId('project-view');
    await expect(view).toContainText('Não estão sendo carregadas');
    await view.getByRole('button', { name: 'Confiar nestas configurações' }).click();
    await expect(view.getByRole('button', { name: 'Deixar de confiar' })).toBeVisible();

    // Instruções do projeto persistem.
    await view.getByRole('textbox', { name: 'Instruções do projeto' }).fill('Site em Next.js.');
    await view.getByRole('button', { name: 'Salvar' }).click();
    await expect(view.getByTestId('project-instructions-status')).toHaveText('Salvo');

    await app.close();
    ({ app, page } = await launchApp(userData));
    await page.getByRole('button', { name: 'Abrir projeto repo-site: instruções e detalhes' }).click();
    await expect(page.getByRole('textbox', { name: 'Instruções do projeto' })).toHaveValue('Site em Next.js.');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('recusa pasta inexistente e pasta de outro Workspace; instruções gerais persistem', async () => {
  const userData = tempUserData();
  let { app, page } = await launchApp(userData);
  try {
    const pessoal = await createWorkspace(page, 'Pessoal');
    const dev = await createWorkspace(page, 'Dev');

    const dialog = await addLinkedProject(page, path.join(userData, 'nao-existe'));
    await expect(dialog.getByRole('alert')).toContainText('Pasta não encontrada');
    await expect(dialog.getByRole('button', { name: 'Adicionar projeto' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    const invasion = await page.evaluate(
      ([wsId, p]) =>
        window.nexus.invoke('projects:create', {
          kind: 'linked',
          workspaceId: wsId,
          name: 'Invasão',
          path: p,
          trustConfig: false,
        }),
      [dev.id, path.join(pessoal.rootPath, 'Conhecimentos')],
    );
    expect(invasion).toMatchObject({ ok: false, error: { message: expect.stringContaining('Pessoal') } });

    await page.keyboard.press('Control+,');
    const global = page.getByTestId('global-instructions');
    await global.getByRole('textbox', { name: 'Instruções gerais' }).fill('Trabalho com planilhas.');
    await global.getByRole('button', { name: 'Salvar' }).click();
    await expect(global).toContainText('Salvo');

    await app.close();
    ({ app, page } = await launchApp(userData));
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('textbox', { name: 'Instruções gerais' })).toHaveValue('Trabalho com planilhas.');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  async function ask(page: Page, text: string, count: number) {
    const box = page.getByRole('textbox', { name: 'Mensagem' });
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await box.fill(text);
    await box.press('Enter');
    await expect(page.getByTestId('message-assistant')).toHaveCount(count, { timeout: 120_000 });
    return page.getByTestId('message-assistant').last();
  }

  test('isolamento: a palavra secreta de um Workspace não chega a outro', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const a = await createWorkspace(page, 'Com segredo');
      await page.evaluate(async (id) => {
        const cur = (await window.nexus.invoke('workspaces:readInstructions', { id })) as {
          ok: true;
          data: { mtimeMs: number };
        };
        await window.nexus.invoke('workspaces:saveInstructions', {
          id,
          content: 'A palavra secreta deste Workspace é GIRASSOL.',
          expectedMtimeMs: cur.data.mtimeMs,
        });
      }, a.id);
      const question = 'Qual é a palavra secreta definida nas suas instruções? Se não houver, responda só: nenhuma.';

      expect(await (await ask(page, question, 1)).textContent()).toContain('GIRASSOL');

      await createWorkspace(page, 'Sem segredo');
      const answer = await ask(page, question, 1);
      expect((await answer.textContent())?.toUpperCase()).not.toContain('GIRASSOL');
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });

  test('conversa de projeto e importação de conversa do Claude Code', async () => {
    const shared = tempUserData();
    const repo = path.join(shared, 'repo-real');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'projeto.txt'), 'O código do projeto é 9090.\n');

    // Primeira instância: conversa no projeto (cria uma sessão do Claude Code nesta pasta).
    const first = await launchApp(undefined, options);
    try {
      await createWorkspace(first.page, 'Origem');
      await addLinkedProject(first.page, repo, 'Repo');
      await first.page
        .getByRole('dialog', { name: 'Adicionar projeto' })
        .getByRole('button', { name: 'Adicionar projeto' })
        .click();
      const answer = await ask(first.page, 'Leia projeto.txt e diga só o código.', 1);
      await expect(answer).toContainText('9090');
    } finally {
      await first.app.close();
      removeUserData(first.userData);
    }

    // Segunda instância (outro banco): importa a conversa que o Claude Code já tem nesta pasta e continua.
    const second = await launchApp(undefined, options);
    try {
      await createWorkspace(second.page, 'Destino');
      await addLinkedProject(second.page, repo, 'Repo');
      await second.page
        .getByRole('dialog', { name: 'Adicionar projeto' })
        .getByRole('button', { name: 'Adicionar projeto' })
        .click();
      await second.page.getByRole('button', { name: 'Abrir projeto Repo: instruções e detalhes' }).click();
      await second.page.getByRole('button', { name: 'Procurar conversas' }).click();
      const list = second.page.getByRole('list', { name: 'Conversas do Claude Code' });
      await list.getByRole('button', { name: 'Importar' }).first().click();

      await expect(second.page.getByTestId('message-user').first()).toContainText('projeto.txt');
      const answer = await ask(second.page, 'Qual código você me disse antes? Responda só o número.', 2);
      await expect(answer).toContainText('9090');
    } finally {
      await second.app.close();
      removeUserData(second.userData);
      fs.rmSync(shared, { recursive: true, force: true });
    }
  });
});

test('arrastar muda a ordem dos projetos, o teclado também, e a ordem sobrevive a reiniciar', async () => {
  const userData = tempUserData();
  let { app, page } = await launchApp(userData);
  try {
    const ws = await createWorkspace(page, 'Dev');
    for (const name of ['Alfa', 'Beta', 'Gama']) {
      await page.evaluate(
        ([id, n]) => window.nexus.invoke('projects:create', { kind: 'managed', workspaceId: id, name: n }),
        [ws.id, name],
      );
    }
    await page.reload();
    await page.getByTestId('chat-view').waitFor();

    const names = async () =>
      (await projectList(page).locator('li[draggable="true"]').allInnerTexts()).map((t) => t.trim());
    // Projetos novos entram no fim, na ordem em que foram criados.
    expect(await names()).toEqual(['Alfa', 'Beta', 'Gama']);

    // Arrastar o último para cima do primeiro.
    await page
      .getByTestId('project-Gama')
      .dragTo(page.getByTestId('project-Alfa'), { targetPosition: { x: 40, y: 3 } });
    await expect.poll(names).toEqual(['Gama', 'Alfa', 'Beta']);

    // Teclado: Alt + seta para baixo desce o projeto focado.
    await page.getByRole('button', { name: 'Gama', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(names).toEqual(['Alfa', 'Gama', 'Beta']);

    await app.close();
    ({ app, page } = await launchApp(userData));
    await expect(projectList(page).locator('li[draggable="true"]').first()).toHaveText('Alfa');
    expect(await names()).toEqual(['Alfa', 'Gama', 'Beta']);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('Workspace novo já nasce com Sonnet · Médio como modelo padrão', async () => {
  const userData = tempUserData();
  const { app, page } = await launchApp(userData);
  try {
    const ws = await createWorkspace(page, 'Dev');
    const r = (await page.evaluate(() => window.nexus.invoke('workspaces:list', undefined))) as {
      ok: true;
      data: { workspaces: Array<{ id: string; defaultModel: string | null; defaultEffort: string | null }> };
    };
    expect(r.data.workspaces.find((w) => w.id === ws.id)).toMatchObject({
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
    });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('as pastas do projeto escolhido aparecem abaixo das conversas e o arquivo clicado abre no painel', async () => {
  const userData = tempUserData();
  const { app, page } = await launchApp(userData);
  try {
    await createWorkspace(page, 'Dev');
    const repo = path.join(userData, 'repo-pastas');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'leia-me.md'), '# Olá do projeto\n');
    const dialog = await addLinkedProject(page, repo, 'Pastas');
    await dialog.getByRole('button', { name: 'Adicionar projeto' }).click();
    await expect(dialog).toBeHidden();

    const section = page.getByTestId('folder-section');
    await expect(section).toContainText('Pastas · Pastas');
    // Fica depois da lista de conversas, na barra lateral.
    const conversationsBox = await page.getByRole('list', { name: 'Lista de conversas' }).boundingBox();
    const sectionBox = await section.boundingBox();
    expect(sectionBox!.y).toBeGreaterThan(conversationsBox!.y);

    const tree = section.getByRole('tree', { name: 'Arquivos' });
    await expect(tree.getByRole('button', { name: 'docs', exact: true })).toBeVisible();
    // Nada abre sozinho: o painel de código só mostra um arquivo depois do clique.
    await expect(page.getByTestId('code-file')).toHaveCount(0);
    await tree.getByRole('button', { name: 'leia-me.md', exact: true }).click();
    await expect(page.getByTestId('code-file')).toContainText('leia-me.md');
    await expect(page.getByTestId('code-file').locator('.monaco-editor .view-lines')).toContainText('Olá do projeto');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
