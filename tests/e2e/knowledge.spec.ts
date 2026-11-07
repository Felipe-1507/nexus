import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Segundo cérebro (Etapa 8).

async function createWorkspace(page: Page, name: string): Promise<{ id: string; knowledgeDir: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; knowledgeDir: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Painel lateral' });

test('criar, editar, ligar, acompanhar mudanças de fora e excluir notas', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Trabalho');
    await expect(panel(page)).toContainText('Nenhuma nota ainda');

    // Nova nota pelo painel.
    await panel(page).getByRole('button', { name: 'Nova nota' }).click();
    await panel(page).getByRole('textbox', { name: 'Nome da nota' }).fill('Fechamento Mensal');
    await panel(page).getByRole('textbox', { name: 'Nome da nota' }).press('Enter');
    const editor = page.getByTestId('note-editor');
    await expect(editor.getByTestId('note-preview')).toContainText('Fechamento Mensal');

    // Edição no CodeMirror com salvamento automático.
    await editor.getByRole('button', { name: 'Editar nota' }).click();
    const content = editor.getByRole('textbox', { name: 'Conteúdo da nota' });
    await content.fill('# Fechamento Mensal\n\nVai até o dia 5. Depende da [[Conciliação Bancária]]. #trabalho');
    await expect(editor.getByTestId('note-status')).toHaveText('Salvo');
    const file = path.join(ws.knowledgeDir, 'Fechamento Mensal.md');
    expect(fs.readFileSync(file, 'utf8')).toContain('[[Conciliação Bancária]]');

    // Link para nota que não existe cria a nota; a nova mostra quem a menciona.
    await editor.getByRole('button', { name: 'Visualizar nota' }).click();
    await editor.getByRole('link', { name: 'Conciliação Bancária' }).click();
    await expect(editor.getByTestId('note-preview')).toContainText('Conciliação Bancária');
    expect(fs.existsSync(path.join(ws.knowledgeDir, 'Conciliação Bancária.md'))).toBe(true);
    await expect(editor.getByTestId('note-backlinks')).toContainText('Fechamento Mensal');

    // Alteração feita por fora (outro programa ou o Claude) aparece sozinha.
    fs.writeFileSync(
      path.join(ws.knowledgeDir, 'Conciliação Bancária.md'),
      '# Conciliação Bancária\n\nDiária, às 10h.',
    );
    await expect(editor.getByTestId('note-preview')).toContainText('Diária, às 10h.', { timeout: 10_000 });

    // Lista com filtro.
    await editor.getByRole('button', { name: 'Voltar às notas' }).click();
    const tree = panel(page).getByRole('tree', { name: 'Notas' });
    await expect(tree.getByRole('treeitem')).toHaveCount(2);
    await panel(page).getByRole('textbox', { name: 'Filtrar notas' }).fill('fecha');
    await expect(tree.getByRole('treeitem')).toHaveCount(1);
    await panel(page).getByRole('textbox', { name: 'Filtrar notas' }).fill('');

    // Excluir vai para a lixeira do vault.
    await tree.getByRole('button', { name: 'Fechamento Mensal' }).click();
    await page.getByRole('button', { name: 'Mover nota para a lixeira' }).click();
    await expect(tree.getByRole('treeitem')).toHaveCount(1);
    expect(fs.existsSync(path.join(ws.knowledgeDir, '.trash', 'Fechamento Mensal.md'))).toBe(true);

    // Caminho fora do vault é recusado.
    const outside = await page.evaluate(
      (id) => window.nexus.invoke('knowledge:read', { workspaceId: id, path: '../workspace.md' }),
      ws.id,
    );
    expect(outside).toMatchObject({ ok: false });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('o Claude registra no segundo cérebro e consulta depois', async () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.setTimeout(240_000);
  const { app, page, userData } = await launchApp(undefined, { claude: 'real', env: { NEXUS_CLAUDE_MODEL: 'haiku' } });
  try {
    const ws = await createWorkspace(page, 'Trabalho');
    const box = page.getByRole('textbox', { name: 'Mensagem' });
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await box.fill('Registre nas notas: o fechamento mensal da organização vai até o dia 7 de cada mês.');
    await box.press('Enter');
    const answer = page.getByTestId('message-assistant').last();
    await expect(answer).toBeVisible({ timeout: 120_000 });

    const notes = fs
      .readdirSync(ws.knowledgeDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.md'));
    expect(notes.length).toBeGreaterThan(0);
    const text = notes.map((f) => fs.readFileSync(path.join(ws.knowledgeDir, f), 'utf8')).join('\n');
    expect(text).toMatch(/\b7\b/);

    // O cartão da nota abre ao lado da conversa.
    await answer.getByTestId('changed-files').getByRole('button').first().click();
    await expect(page.getByTestId('note-editor')).toBeVisible();

    // Conversa nova (processo novo, índice atualizado) responde a partir da nota.
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await box.fill('Até que dia vai o fechamento mensal? Responda só o número.');
    await box.press('Enter');
    await expect(page.getByTestId('message-assistant').last()).toContainText('7', { timeout: 120_000 });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('editor de notas: comandos "/", listas e tarefas, cores e formatação, tudo gravado como Markdown', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Editor');
    await panel(page).getByRole('button', { name: 'Nova nota' }).click();
    await panel(page).getByRole('textbox', { name: 'Nome da nota' }).fill('Formatação');
    await panel(page).getByRole('textbox', { name: 'Nome da nota' }).press('Enter');
    const editor = page.getByTestId('note-editor');
    await editor.getByRole('button', { name: 'Editar nota' }).click();
    await expect(editor.getByRole('toolbar', { name: 'Formatação da nota' })).toBeVisible();

    const content = editor.getByRole('textbox', { name: 'Conteúdo da nota' });
    const file = path.join(ws.knowledgeDir, 'Formatação.md');
    const read = () => fs.readFileSync(file, 'utf8');
    const menu = page.locator('.cm-tooltip-autocomplete');
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');

    // "/" abre o menu; filtrar por "tit" e Enter vira título 1.
    await page.keyboard.type('/tit');
    await expect(menu).toContainText('Título 1');
    await page.waitForTimeout(200); // o menu só aceita Enter depois de um instante, para não escolher por acidente
    await page.keyboard.press('Enter');
    await page.keyboard.type('Meu plano');
    await page.keyboard.press('Enter');

    // Lista de tarefas pelo menu; Enter continua a lista e Enter numa linha vazia sai dela.
    await page.keyboard.type('/tarefas');
    await expect(menu).toContainText('Lista de tarefas');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.keyboard.type('comprar pão');
    await page.keyboard.press('Enter');
    await page.keyboard.type('pagar boleto');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Lista com marcadores e numerada pelo teclado e pela barra.
    await editor.getByRole('button', { name: 'Lista com marcadores' }).click();
    await page.keyboard.type('um');
    await page.keyboard.press('Enter');
    await page.keyboard.type('dois');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Texto colorido e negrito pela barra: seleciona a palavra digitada.
    await page.keyboard.type('importante');
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await editor.getByRole('button', { name: 'Cor do texto' }).click();
    await editor.getByRole('button', { name: 'Cor Vermelho' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' e forte');
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await editor.getByRole('button', { name: 'Negrito' }).click();

    await expect.poll(read).toContain('# Meu plano');
    await expect.poll(read).toContain('- [ ] comprar pão\n- [ ] pagar boleto\n');
    await expect.poll(read).toContain('- um\n- dois\n');
    await expect.poll(read).toContain('<span style="color:#e03e3e">importante</span> e **forte**');

    // Longe do cursor, a marcação some e o resultado aparece: caixas de seleção, bolinhas e cor.
    await page.keyboard.press('Control+Home');
    await expect(content).not.toContainText('<span');
    await expect(content).not.toContainText('- [ ]');
    await expect(editor.locator('.cm-task-box')).toHaveCount(2);
    await expect(editor.locator('.cm-bullet')).toHaveCount(2);
    await expect(editor.locator('.cm-h1')).toContainText('Meu plano');
    await expect(content.getByText('importante', { exact: true })).toHaveCSS('color', 'rgb(224, 62, 62)');

    // Clicar na caixa marca a tarefa no arquivo.
    await editor.locator('.cm-task-box').first().click();
    await expect.poll(read).toContain('- [x] comprar pão');

    // Na visualização, as cores e as tarefas também aparecem.
    await editor.getByRole('button', { name: 'Visualizar nota' }).click();
    await expect(editor.getByTestId('note-preview').getByText('importante')).toHaveCSS('color', 'rgb(224, 62, 62)');
    await expect(editor.getByTestId('note-preview').locator('input[type="checkbox"]')).toHaveCount(2);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('editor de notas: o frontmatter fica como texto e o Markdown do Obsidian não é alterado ao abrir', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Obsidian');
    const original =
      '---\ntags: [trabalho]\naliases: [Fechamento]\n---\n# Título\n\nTexto com [[Outra nota]] e #etiqueta.\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const file = path.join(ws.knowledgeDir, 'Com propriedades.md');
    fs.writeFileSync(file, original);
    await page.reload();
    await page.getByTestId('chat-view').waitFor();
    await panel(page)
      .getByRole('tree', { name: 'Notas' })
      .getByRole('treeitem', { name: /Com propriedades/ })
      .click();
    const editor = page.getByTestId('note-editor');
    await editor.getByRole('button', { name: 'Editar nota' }).click();
    const content = editor.getByRole('textbox', { name: 'Conteúdo da nota' });

    await expect(content).toContainText('tags: [trabalho]');
    await expect(editor.locator('.cm-frontmatter')).toHaveCount(4);
    await expect(editor.locator('.cm-h1')).toHaveCount(1);
    await expect(editor.locator('.cm-h2')).toHaveCount(0);
    await expect(editor.locator('.cm-hr')).toHaveCount(1); // só o divisor de verdade
    await expect(editor.locator('.cm-wikilink')).toHaveText('Outra nota');

    // Abrir e fechar o editor não reescreve o arquivo.
    await editor.getByRole('button', { name: 'Visualizar nota' }).click();
    await page.waitForTimeout(1500);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
