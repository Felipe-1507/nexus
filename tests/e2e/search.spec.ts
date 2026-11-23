import { expect, test, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchApp, removeUserData } from './launch';

// Busca nas conversas: geral (todo o Workspace) e localizada (só um projeto). O banco é semeado com o app fechado; nada
// disto chama o Claude.

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface Seed {
  title: string;
  projectId: string | null;
  at: string;
  messages: Array<['user' | 'assistant', string]>;
}

function seed(userData: string, workspaceId: string, cwd: string, items: Seed[]): void {
  const db = new DatabaseSync(path.join(userData, 'nexus.db'));
  db.exec('PRAGMA foreign_keys = ON');
  for (const s of items) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO conversations (id, workspace_id, project_id, title, cwd, claude_session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, workspaceId, s.projectId, s.title, cwd, crypto.randomUUID(), s.at, s.at);
    s.messages.forEach(([role, content], i) => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, seq, role, content, status, activities, attachments, created_at)
         VALUES (?, ?, ?, ?, ?, 'complete', '[]', '[]', ?)`,
      ).run(crypto.randomUUID(), id, i + 1, role, content, s.at);
    });
  }
  db.close();
}

async function launchSeeded() {
  const first = await launchApp();
  const ws = (await first.page.evaluate(() =>
    window.nexus.invoke('workspaces:create', { name: 'Trabalho', color: 'violet', icon: 'layers' }),
  )) as { ok: true; data: { id: string; rootPath: string; knowledgeDir: string } };
  // Uma nota do vault com a mesma palavra das conversas: a busca da galáxia mostra as duas coisas.
  fs.mkdirSync(ws.data.knowledgeDir, { recursive: true });
  fs.writeFileSync(path.join(ws.data.knowledgeDir, 'Boletos do fornecedor.md'), '# Boletos do fornecedor\n');
  const project = (await first.page.evaluate(
    (id) => window.nexus.invoke('projects:create', { kind: 'managed', workspaceId: id, name: 'Alfa' }),
    ws.data.id,
  )) as { ok: true; data: { id: string } };
  await first.app.close();

  const long: Array<['user' | 'assistant', string]> = [];
  for (let i = 1; i <= 150; i++) {
    long.push([i % 2 ? 'user' : 'assistant', i === 3 ? 'Anote a palavra-rara-zeta para depois' : `enchimento ${i}`]);
  }
  seed(first.userData, ws.data.id, ws.data.rootPath, [
    {
      title: 'Boleto geral',
      projectId: null,
      at: minutesAgo(10),
      messages: [
        ['user', 'Qual a situação do boleto do fornecedor?'],
        ['assistant', 'O boleto vence amanhã e está em aberto.'],
      ],
    },
    {
      title: 'Boleto do Alfa',
      projectId: project.data.id,
      at: minutesAgo(5),
      messages: [
        ['user', 'Gere o boleto do Alfa'],
        ['assistant', 'Feito: boleto emitido para o Alfa.'],
      ],
    },
    { title: 'Conversa muito longa', projectId: null, at: minutesAgo(60), messages: long },
  ]);
  const second = await launchApp(first.userData);
  return { ...second, projectId: project.data.id };
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Buscar' });
const box = (page: Page) => dialog(page).getByRole('searchbox', { name: 'Texto da busca' });
const results = (page: Page) => dialog(page).getByTestId('search-results');

test('busca geral: acha o que o usuário disse e o que o Claude respondeu, sem acento, e abre a conversa', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await page.getByRole('button', { name: /^Buscar \(Ctrl/ }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByTestId('search-status')).toHaveText('Digite ao menos 2 letras');

    await box(page).fill('SITUACAO boleto');
    await expect(results(page).getByRole('button')).toHaveCount(1);
    await expect(results(page)).toContainText('Boleto geral');
    await expect(results(page)).toContainText('Você');
    await expect(results(page).locator('mark').first()).toHaveText('situação');

    await box(page).fill('boleto');
    // Duas conversas (a geral e a do Alfa), cada uma com a pergunta e a resposta.
    await expect(results(page).getByRole('button')).toHaveCount(4);
    await expect(results(page)).toContainText('Claude');
    await expect(results(page)).toContainText('Alfa');
    await expect(results(page)).toContainText('Geral');

    await box(page).fill('nao existe isto');
    await expect(dialog(page).getByTestId('search-status')).toHaveText('Nada encontrado');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('busca localizada: dentro de um projeto começa só nele e dá para ampliar para o Workspace', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await page
      .getByRole('list', { name: 'Lista de projetos' })
      .getByRole('button', { name: 'Alfa', exact: true })
      .click();
    await page.keyboard.press('Control+Shift+F');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Só em Alfa' })).toHaveAttribute('aria-pressed', 'true');

    await box(page).fill('boleto');
    await expect(results(page).getByRole('button')).toHaveCount(2);
    await expect(results(page)).toContainText('Boleto do Alfa');
    await expect(results(page)).not.toContainText('Boleto geral');

    await dialog(page).getByRole('button', { name: 'Todo o Workspace' }).click();
    await expect(results(page).getByRole('button')).toHaveCount(4);
    await expect(results(page)).toContainText('Boleto geral');

    // Escolher uma conversa de fora do projeto troca o escopo e abre a conversa.
    await results(page).getByRole('button').filter({ hasText: 'situação' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByTestId('message-user').first()).toContainText('situação do boleto');
    await expect(page.getByTestId('message-user').first()).toHaveAttribute('data-found', 'true');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('o resultado leva à mensagem exata, mesmo numa conversa longa em que ela estava escondida', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await page.keyboard.press('Control+Shift+F');
    await box(page).fill('palavra-rara-zeta');
    await expect(results(page).getByRole('button')).toHaveCount(1);
    await results(page).getByRole('button').click();

    const found = page.locator('[data-message-id][data-found="true"]');
    await expect(found).toContainText('palavra-rara-zeta');
    await expect(found).toBeInViewport();
    // O destaque some sozinho.
    await expect(found).toHaveCount(0, { timeout: 8_000 });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('o teclado basta: Enter abre o primeiro resultado e Esc fecha a janela', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await page.keyboard.press('Control+Shift+F');
    await expect(box(page)).toBeFocused();
    await box(page).fill('emitido');
    await expect(results(page).getByRole('button')).toHaveCount(1);
    await box(page).press('Enter');
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByTestId('message-assistant').first()).toContainText('boleto emitido');

    await page.keyboard.press('Control+Shift+F');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('busca única na galáxia: notas e conversas na mesma lista; o trecho abre a conversa na mensagem certa', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Galáxia' })
      .click();
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-ready', 'true');
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('boleto');

    // Notas (por título) e conversas (por conteúdo) aparecem juntas; a nota acende na galáxia.
    const list = page.getByRole('listbox', { name: 'Resultados da busca' });
    await expect(list.getByTestId('search-note')).toHaveCount(1);
    await expect(list.getByTestId('search-note')).toContainText('Boletos do fornecedor');
    await expect(list.getByTestId('search-chat').first()).toBeVisible();
    await expect(list.getByTestId('search-chat').filter({ hasText: 'situação' })).toHaveCount(1);
    await expect(page.getByTestId('search-count')).toHaveText('1 nota acesa na galáxia');
    // Tem destaque nas palavras achadas.
    await expect(list.locator('mark').first()).toHaveText(/boleto/i);

    // Escolher o trecho de uma conversa abre o chat e destaca a mensagem.
    await list.getByTestId('search-chat').filter({ hasText: 'situação' }).click();
    await expect(page.getByTestId('chat-view')).toBeVisible();
    await expect(page.getByTestId('message-user').first()).toContainText('situação do boleto');
    await expect(page.getByTestId('message-user').first()).toHaveAttribute('data-found', 'true');

    // Com #tag só notas entram (tag não existe em conversa).
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Galáxia' })
      .click();
    await search.fill('#trabalho');
    await expect(list.getByTestId('search-chat')).toHaveCount(0);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
