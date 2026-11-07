import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Medidor de contexto, painel de sessões e "Continuar em nova conversa". Estes testes não gastam cota: o banco é
// semeado com o app fechado (como se o Nexus tivesse sido reiniciado) e o Claude Code é simulado como ausente.

const ID = {
  critical: 'a0000000-0000-4000-8000-00000000000a',
  high: 'b0000000-0000-4000-8000-00000000000b',
  light: 'c0000000-0000-4000-8000-00000000000c',
  noWindow: 'd0000000-0000-4000-8000-00000000000d',
  none: 'e0000000-0000-4000-8000-00000000000e',
  fork: 'f0000000-0000-4000-8000-00000000000f',
};
const TITLE = {
  critical: 'Cadastro quase cheio',
  high: 'Cadastro elevado',
  light: 'Conversa leve',
  noWindow: 'Sem janela',
  none: 'Sem medição',
  fork: 'Continuação: Cadastro quase cheio',
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface Seed {
  id: string;
  title: string;
  at: string;
  context?: {
    tokens: number | null;
    window: number | null;
    model?: string;
    lastCallAt: string;
    cacheRead?: number;
    cacheCreation?: number;
    costUsd?: number | null;
    rebuilt?: boolean | null;
    compaction?: { pre: number; post: number };
  };
  forkedFrom?: string;
}

/** Grava conversas e medições direto no banco (o app precisa estar fechado). */
function seed(userData: string, workspaceId: string, cwd: string, items: Seed[]): void {
  const db = new DatabaseSync(path.join(userData, 'nexus.db'));
  db.exec('PRAGMA foreign_keys = ON');
  for (const s of items) {
    db.prepare(
      `INSERT INTO conversations (id, workspace_id, title, cwd, claude_session_id, created_at, updated_at, forked_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(s.id, workspaceId, s.title, cwd, crypto.randomUUID(), s.at, s.at, s.forkedFrom ?? null);
    db.prepare(
      `INSERT INTO messages (id, conversation_id, seq, role, content, status, activities, attachments, created_at)
       VALUES (?, ?, 1, 'user', 'mensagem de teste', 'complete', '[]', '[]', ?)`,
    ).run(crypto.randomUUID(), s.id, s.at);
    if (!s.context) continue;
    const c = s.context;
    db.prepare(
      `INSERT INTO conversation_context
         (conversation_id, source, model, context_tokens, input_tokens, cache_read_tokens, cache_creation_tokens,
          window_tokens, last_call_at, cache_rebuilt, cost_usd, compaction_trigger, compaction_pre_tokens,
          compaction_post_tokens, compaction_at, updated_at)
       VALUES (?, 'live', ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      s.id,
      c.model ?? 'claude-sonnet-5-5',
      c.tokens,
      c.cacheRead ?? null,
      c.cacheCreation ?? null,
      c.window,
      c.lastCallAt,
      c.rebuilt === undefined || c.rebuilt === null ? null : c.rebuilt ? 1 : 0,
      c.costUsd ?? null,
      c.compaction ? 'manual' : null,
      c.compaction?.pre ?? null,
      c.compaction?.post ?? null,
      c.compaction ? c.lastCallAt : null,
      c.lastCallAt,
    );
  }
  db.close();
}

async function createWorkspace(page: Page): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(() =>
    window.nexus.invoke('workspaces:create', { name: 'Trabalho', color: 'violet', icon: 'layers' }),
  )) as { ok: true; data: { id: string; rootPath: string } };
  return r.data;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Navegação principal' });
const conversationList = (page: Page) => page.getByRole('list', { name: 'Lista de conversas' });
const openConversation = (page: Page, title: string) =>
  conversationList(page).getByRole('button', { name: title, exact: true }).click();

async function launchSeeded() {
  const first = await launchApp();
  const ws = await createWorkspace(first.page);
  await first.app.close();
  seed(first.userData, ws.id, ws.rootPath, [
    {
      id: ID.critical,
      title: TITLE.critical,
      at: minutesAgo(5),
      context: {
        tokens: 950_000,
        window: 1_000_000,
        lastCallAt: minutesAgo(5),
        cacheRead: 949_000,
        cacheCreation: 996,
        costUsd: 0.45,
        rebuilt: false,
      },
    },
    {
      id: ID.high,
      title: TITLE.high,
      at: minutesAgo(180),
      context: {
        tokens: 800_000,
        window: 1_000_000,
        lastCallAt: minutesAgo(180),
        cacheRead: 15_485,
        cacheCreation: 784_000,
        costUsd: 1.2,
        rebuilt: true,
        compaction: { pre: 396_057, post: 20_437 },
      },
    },
    {
      id: ID.light,
      title: TITLE.light,
      at: minutesAgo(10),
      context: { tokens: 300_000, window: null, lastCallAt: minutesAgo(10), cacheRead: 299_000, cacheCreation: 998 },
    },
    {
      id: ID.noWindow,
      title: TITLE.noWindow,
      at: minutesAgo(80),
      context: { tokens: 120_000, window: null, model: 'modelo-sem-janela', lastCallAt: minutesAgo(80) },
    },
    { id: ID.none, title: TITLE.none, at: minutesAgo(30) },
    {
      id: ID.fork,
      title: TITLE.fork,
      at: minutesAgo(20),
      forkedFrom: ID.critical,
      context: {
        tokens: null,
        window: 1_000_000,
        lastCallAt: minutesAgo(20),
        compaction: { pre: 448_061, post: 21_000 },
      },
    },
  ]);
  const second = await launchApp(first.userData);
  return { ...second, workspaceId: ws.id };
}

test('indicador no cabeçalho: faixa, percentual, avisos e detalhes vêm dos dados gravados', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    // Faixa "contexto elevado" (80%) e conversa parada há 3 h.
    await openConversation(page, TITLE.high);
    const bar = page.getByTestId('context-bar');
    await expect(bar).toHaveAttribute('data-level', 'high');
    await expect(page.getByTestId('context-pill-text')).toHaveText('800 mil · 80%');
    await expect(page.getByTestId('context-warning-high')).toContainText('Contexto elevado');
    await expect(page.getByTestId('context-warning-cache')).toContainText('o cache pode ter expirado');
    await expect(page.getByTestId('context-warning-prompt')).toHaveCount(0);

    await page.getByTestId('context-pill').click();
    const rows = page.getByTestId('context-rows');
    await expect(rows).toContainText('800 mil tokens');
    await expect(rows).toContainText('80,0% de 1,00 mi');
    await expect(rows).toContainText('Contexto elevado');
    await expect(rows).toContainText('Lidos do cache');
    await expect(rows).toContainText('claude-sonnet-5-5');
    await expect(rows).toContainText('Parada há 3 h');
    await expect(rows).toContainText('só a próxima mensagem confirma');
    await expect(rows).toContainText('o cache foi regravado (confirmado');
    await expect(rows).toContainText('manual · 396.057 → 20.437');
    await expect(rows).toContainText('US$ 1,20 em preço de lista');
    await expect(rows).toContainText('não é a porcentagem da cota do plano');

    // Quase cheio (95%): recomenda uma conversa nova, sem aviso de cache (atividade há 5 min).
    await openConversation(page, TITLE.critical);
    await expect(page.getByTestId('context-bar')).toHaveAttribute('data-level', 'critical');
    await expect(page.getByTestId('context-pill-text')).toHaveText('950 mil · 95%');
    await expect(page.getByTestId('context-warning-critical')).toContainText('quase cheio');
    await expect(page.getByTestId('context-warning-cache')).toHaveCount(0);

    // Normal (30%): nenhum aviso.
    await openConversation(page, TITLE.light);
    await expect(page.getByTestId('context-bar')).toHaveAttribute('data-level', 'normal');
    await expect(page.getByTestId('context-pill-text')).toHaveText('300 mil · 30%');
    await expect(page.getByTestId('context-warnings')).toHaveCount(0);
    // A janela desta conversa não foi gravada: vem de outra conversa do mesmo modelo, e a tela diz isso.
    await page.getByTestId('context-pill').click();
    await expect(page.getByTestId('context-rows')).toContainText('janela informada por outra conversa do mesmo modelo');
    await page.getByTestId('context-pill').click();

    // Sem a janela do modelo, o percentual não é inventado.
    await openConversation(page, TITLE.noWindow);
    await expect(page.getByTestId('context-bar')).toHaveAttribute('data-level', 'unknown');
    await expect(page.getByTestId('context-pill-text')).toHaveText('120 mil tokens');
    await page.getByTestId('context-pill').click();
    await expect(page.getByTestId('context-rows')).toContainText('janela do modelo desconhecida: sem percentual');

    // Sem nenhuma medição: diz que não há, não mostra número.
    await openConversation(page, TITLE.none);
    await expect(page.getByTestId('context-pill-text')).toHaveText('Contexto indisponível');
    await page.getByTestId('context-pill').click();
    await expect(page.getByTestId('context-empty')).toContainText('Nenhum número é estimado');

    // Recém-continuada: o tamanho novo só é medido na primeira mensagem, e a conversa de origem fica acessível.
    await openConversation(page, TITLE.fork);
    await expect(page.getByTestId('context-pill-text')).toHaveText('Contexto indisponível');
    await page.getByTestId('context-pill').click();
    await expect(page.getByTestId('context-rows')).toContainText('ainda não medido após a compactação');
    await expect(page.getByTestId('context-rows')).toContainText('448.061 → 21.000');
    await page.getByTestId('context-open-origin').click();
    await expect(page.getByTestId('context-pill-text')).toHaveText('950 mil · 95%');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('painel geral: lista tudo, ordena por contexto e por atividade, e abre a conversa', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await nav(page).getByRole('button', { name: 'Sessões' }).click();
    const overview = page.getByTestId('sessions-overview');
    await expect(overview).toBeVisible();
    const rows = page.getByTestId('session-row');
    await expect(rows).toHaveCount(6);
    await expect(page.getByTestId('sessions-summary')).toContainText('6 conversas');
    await expect(page.getByTestId('sessions-summary')).toContainText('2 com contexto a observar');

    const order = async () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-conversation-id')));
    // Padrão: maior contexto primeiro; conversas sem medição por último (da mais recente para a mais antiga).
    expect(await order()).toEqual([ID.critical, ID.high, ID.light, ID.noWindow, ID.fork, ID.none]);

    const byId = (id: string) => page.locator(`[data-testid="session-row"][data-conversation-id="${id}"]`);
    await expect(byId(ID.critical)).toHaveAttribute('data-level', 'critical');
    await expect(byId(ID.critical).getByTestId('session-percent')).toContainText('95%');
    await expect(byId(ID.critical).getByTestId('session-cache')).toHaveText('Ativo');
    await expect(
      byId(ID.critical)
        .getByTestId('session-attention')
        .getByLabel(/Quase cheio/),
    ).toBeVisible();
    await expect(byId(ID.high).getByTestId('session-cache')).toHaveText('Pode ter expirado');
    await expect(
      byId(ID.high)
        .getByTestId('session-attention')
        .getByLabel(/Contexto elevado.*cache pode ter expirado/),
    ).toBeVisible();
    await expect(byId(ID.light).getByTestId('session-attention').locator('svg')).toHaveCount(0);
    await expect(byId(ID.noWindow).getByTestId('session-percent')).toHaveText('—');
    await expect(byId(ID.none).getByTestId('session-context')).toHaveText('indisponível');
    await expect(byId(ID.fork).getByTestId('session-context')).toHaveText('indisponível');
    // Projeto ou "Geral".
    await expect(byId(ID.light)).toContainText('Geral');

    // Contexto crescente: o menor primeiro, e as sem medição continuam no fim.
    await page.getByRole('button', { name: 'Contexto' }).click();
    expect(await order()).toEqual([ID.noWindow, ID.light, ID.high, ID.critical, ID.fork, ID.none]);

    // Última atividade: mais recente primeiro; clicar de novo inverte.
    await page.getByRole('button', { name: 'Última atividade' }).click();
    expect(await order()).toEqual([ID.critical, ID.light, ID.fork, ID.none, ID.noWindow, ID.high]);
    await page.getByRole('button', { name: 'Última atividade' }).click();
    expect(await order()).toEqual([ID.high, ID.noWindow, ID.none, ID.fork, ID.light, ID.critical]);

    // Abrir uma conversa leva ao chat, já com o indicador dela.
    await byId(ID.light).getByRole('button', { name: TITLE.light }).click();
    await expect(page.getByTestId('chat-view')).toBeVisible();
    await expect(page.getByTestId('context-pill-text')).toHaveText('300 mil · 30%');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('limites configuráveis mudam as faixas, recusam ordem inválida e sobrevivem a reiniciar', async () => {
  const { app, page, userData } = await launchSeeded();
  let restarted: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    await nav(page).getByRole('button', { name: 'Configurações' }).click();
    const section = page.getByTestId('context-thresholds');
    await expect(section.getByTestId('threshold-attention')).toHaveValue('50');
    await expect(section.getByTestId('threshold-high')).toHaveValue('75');
    await expect(section.getByTestId('threshold-critical')).toHaveValue('90');

    await section.getByTestId('threshold-attention').fill('80');
    await section.getByTestId('threshold-save').click();
    await expect(section.getByTestId('threshold-error')).toContainText('ordem crescente');

    await section.getByTestId('threshold-attention').fill('20');
    await section.getByTestId('threshold-high').fill('40');
    await section.getByTestId('threshold-critical').fill('60');
    await section.getByTestId('threshold-save').click();
    await expect(section.getByRole('status')).toContainText('Limites salvos');

    // A conversa de 30% passa a ser "atenção"; a de 80% passa a "quase cheio".
    await nav(page).getByRole('button', { name: 'Sessões' }).click();
    await expect(page.locator(`[data-conversation-id="${ID.light}"]`)).toHaveAttribute('data-level', 'attention');
    await expect(page.locator(`[data-conversation-id="${ID.high}"]`)).toHaveAttribute('data-level', 'critical');

    // Reiniciar o Nexus mantém os limites e as medições.
    await app.close();
    restarted = await launchApp(userData);
    await nav(restarted.page).getByRole('button', { name: 'Sessões' }).click();
    await expect(restarted.page.locator(`[data-conversation-id="${ID.light}"]`)).toHaveAttribute(
      'data-level',
      'attention',
    );
    await expect(
      restarted.page.locator(`[data-conversation-id="${ID.critical}"]`).getByTestId('session-context'),
    ).toHaveText('950 mil');
    await nav(restarted.page).getByRole('button', { name: 'Configurações' }).click();
    await expect(restarted.page.getByTestId('threshold-attention')).toHaveValue('20');
    await restarted.page.getByRole('button', { name: 'Restaurar padrão' }).click();
    await expect(restarted.page.getByTestId('threshold-critical')).toHaveValue('90');
  } finally {
    await (restarted?.app ?? app).close().catch(() => undefined);
    removeUserData(userData);
  }
});

test('confirmação de "Continuar em nova conversa": mostra o custo e os avisos, e a falha não cria nada', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await openConversation(page, TITLE.high);
    const before = await conversationList(page).getByRole('button').count();

    await page.getByTestId('context-pill').click();
    await page.getByTestId('context-continue').click();
    const dialog = page.getByTestId('continue-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('continue-context')).toContainText('800 mil tokens · 80% da janela (elevado)');
    await expect(dialog.getByTestId('continue-process')).toContainText('cerca de 800 mil tokens');
    await expect(dialog.getByTestId('continue-cache')).toContainText('pode ter expirado');
    await expect(dialog.getByTestId('continue-cache')).toContainText('gravado de novo');
    await expect(dialog.getByTestId('continue-cost')).toContainText('US$ 1,20 em preço de lista');
    await expect(dialog).toContainText('não representa diretamente a porcentagem da cota do plano Pro');
    await expect(dialog.getByTestId('continue-undo-note')).toContainText('"Desfazer"');
    await expect(dialog.getByTestId('continue-structured')).toBeChecked();

    // Sem o Claude Code (simulado como ausente), a operação falha antes de copiar qualquer coisa.
    await dialog.getByTestId('continue-confirm').click();
    await expect(dialog.getByTestId('continue-error')).toContainText('Claude Code não está disponível');
    await expect(dialog.getByTestId('continue-error')).toContainText('Nada foi criado');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    await expect(conversationList(page).getByRole('button')).toHaveCount(before);
    // A conversa de origem segue como estava.
    await expect(page.getByTestId('context-pill-text')).toHaveText('800 mil · 80%');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Com o Claude Code de verdade (Haiku, conversa mínima): confere a medição contra a transcrição dele, a persistência
// após reiniciar, o fork + compactação e a integridade da conversa original.

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 420_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };
  const composer = (page: Page) => page.getByRole('textbox', { name: 'Mensagem' });
  const PILL = /\d+( mil)? · \d+%$/;
  const FIRST_MESSAGE = 'Guarde este código secreto: ZEBRA-7731. Responda somente: ok-um';

  /** Contexto da última chamada à API, lido do arquivo de transcrição do Claude Code (a verdade independente). */
  function lastCallContext(file: string): number {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]!.includes('"type":"assistant"')) continue;
      const o = JSON.parse(lines[i]!) as {
        isSidechain?: boolean;
        message?: { model?: string; usage?: Record<string, number> };
      };
      const u = o.message?.usage;
      if (!u || o.isSidechain || o.message?.model === '<synthetic>') continue;
      return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
    throw new Error('nenhuma chamada na transcrição');
  }

  const projectDir = (cwd: string) => path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  interface StateResult {
    ok: true;
    data: {
      snapshot: {
        contextTokens: number | null;
        source: string;
        windowTokens: number | null;
        model: string | null;
        lastCompaction: { preTokens: number; postTokens: number | null } | null;
      } | null;
    };
  }
  const state = async (page: Page, conversationId: string) =>
    (await page.evaluate(
      (id) => window.nexus.invoke('context:get', { conversationId: id }),
      conversationId,
    )) as StateResult;

  test('mede cada resposta, guarda após reiniciar, e o fork compactado deixa a original intacta', async () => {
    const first = await launchApp(undefined, options);
    const userData = first.userData;
    let rootPath = '';
    let second: Awaited<ReturnType<typeof launchApp>> | undefined;
    let third: Awaited<ReturnType<typeof launchApp>> | undefined;
    try {
      const ws = await createWorkspace(first.page);
      rootPath = ws.rootPath;
      await first.page.reload();
      await expect(composer(first.page)).toBeEnabled({ timeout: 30_000 });

      await composer(first.page).fill(FIRST_MESSAGE);
      await composer(first.page).press('Enter');
      await expect(first.page.getByTestId('message-assistant').last()).toContainText('ok-um', { timeout: 120_000 });
      const list = (await first.page.evaluate(
        (w) => window.nexus.invoke('conversations:list', { workspaceId: w, projectId: null }),
        ws.id,
      )) as { data: Array<{ id: string }> };
      const originalId = list.data[0]!.id;

      // 1ª resposta: o indicador aparece sozinho, com janela e percentual vindos do resultado do turno.
      await expect(first.page.getByTestId('context-pill-text')).toHaveText(PILL, { timeout: 15_000 });
      const s1 = (await state(first.page, originalId)).data.snapshot!;
      expect(s1).toMatchObject({ source: 'live', windowTokens: 1_000_000 });
      expect(s1.model).toContain('haiku');

      // 2ª resposta: o medidor acompanha a conversa (o contexto cresceu) sem recarregar nada.
      await composer(first.page).fill('Responda somente: ok-dois');
      await composer(first.page).press('Enter');
      await expect(first.page.getByTestId('message-assistant').last()).toContainText('ok-dois', { timeout: 120_000 });
      await expect
        .poll(async () => (await state(first.page, originalId)).data.snapshot?.contextTokens ?? 0, { timeout: 15_000 })
        .toBeGreaterThan(s1.contextTokens!);
      const s2 = (await state(first.page, originalId)).data.snapshot!;

      // Reiniciar o Nexus: a medição continua lá, igual.
      await first.app.close();
      second = await launchApp(userData, options);
      const page = second.page;
      await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
      await conversationList(page).getByRole('button').first().click();
      expect((await state(page, originalId)).data.snapshot).toMatchObject({
        contextTokens: s2.contextTokens,
        source: 'live',
      });
      await expect(page.getByTestId('context-pill-text')).toHaveText(PILL);

      // A medição bate com o uso real da última chamada, registrado pelo próprio Claude Code.
      const db = new DatabaseSync(path.join(userData, 'nexus.db'), { readOnly: true });
      const row = db.prepare('SELECT claude_session_id AS sid FROM conversations WHERE id = ?').get(originalId) as {
        sid: string;
      };
      db.close();
      const file = path.join(projectDir(rootPath), `${row.sid}.jsonl`);
      expect(lastCallContext(file)).toBe(s2.contextTokens);
      const hashBefore = sha(file);

      // Continuar em nova conversa (resumo estruturado ligado por padrão).
      await page.getByTestId('context-pill').click();
      await page.getByTestId('context-continue').click();
      const dialog = page.getByTestId('continue-dialog');
      await expect(dialog.getByTestId('continue-context')).toContainText('tokens');
      await expect(dialog.getByTestId('continue-structured')).toBeChecked();
      await dialog.getByTestId('continue-confirm').click();
      await expect(dialog.getByTestId('continue-progress')).toBeVisible();

      // A conversa nova abre sozinha, mostra o antes/depois da compactação e o resumo, e aponta para a original.
      const intro = page.getByTestId('message-assistant').first();
      await expect(intro).toContainText('Continuação de', { timeout: 240_000 });
      await expect(intro).toContainText('→');
      await expect(page.getByTestId('context-open-origin')).toBeVisible();
      await expect(page.getByTestId('context-pill-text')).toHaveText('Contexto indisponível');

      // Original intacta: o arquivo da sessão não mudou um byte.
      expect(sha(file)).toBe(hashBefore);

      // A conversa nova continua de verdade, com o contexto compactado (o código secreto sobreviveu).
      await composer(page).fill('Qual era o código secreto? Responda só o código.');
      await composer(page).press('Enter');
      await expect(page.getByTestId('message-assistant').last()).toContainText('ZEBRA-7731', { timeout: 120_000 });
      await expect(page.getByTestId('context-pill-text')).toHaveText(PILL, { timeout: 15_000 });

      // Repetir o pedido na original não cria uma segunda continuação.
      await page.getByTestId('context-open-origin').click();
      await page.getByTestId('context-pill').click();
      await page.getByTestId('context-continue').click();
      await expect(page.getByTestId('continue-existing')).toContainText('Continuação:');
      await page.getByRole('button', { name: 'Cancelar' }).click();

      await second.app.close();
      const check = new DatabaseSync(path.join(userData, 'nexus.db'), { readOnly: true });
      const conversations = check
        .prepare('SELECT id, claude_session_id AS sid, forked_from AS forkedFrom FROM conversations')
        .all() as Array<{ id: string; sid: string; forkedFrom: string | null }>;
      expect(conversations).toHaveLength(2);
      const fork = conversations.find((c) => c.forkedFrom === originalId)!;
      expect(fork.sid).not.toBe(row.sid);
      const compaction = check
        .prepare(
          'SELECT pre_tokens AS pre, post_tokens AS post, trigger, source_conversation_id AS src FROM compactions WHERE conversation_id = ?',
        )
        .get(fork.id) as { pre: number; post: number; trigger: string; src: string };
      check.close();
      expect(compaction).toMatchObject({ trigger: 'manual', src: originalId });
      expect(compaction.pre).toBeGreaterThan(0);
      expect(compaction.post).toBeGreaterThan(0);
      expect(compaction.post).toBeLessThan(compaction.pre);
      // Depois de tudo, o arquivo da sessão original continua idêntico.
      expect(sha(file)).toBe(hashBefore);

      // Conversa antiga (sem medição gravada, como uma importada do VS Code): a medição é reconstruída do histórico do
      // Claude Code, sem abrir a sessão, e a janela vem da outra conversa do mesmo modelo.
      const wipe = new DatabaseSync(path.join(userData, 'nexus.db'));
      wipe.prepare('DELETE FROM conversation_context WHERE conversation_id = ?').run(originalId);
      const title = (wipe.prepare('SELECT title FROM conversations WHERE id = ?').get(originalId) as { title: string })
        .title;
      wipe.close();
      third = await launchApp(userData, options);
      await openConversation(third.page, title);
      await expect(third.page.getByTestId('context-pill-text')).toHaveText(PILL);
      const old = (await state(third.page, originalId)).data.snapshot as Record<string, unknown>;
      expect(old).toMatchObject({
        source: 'reconstructed',
        contextTokens: s2.contextTokens,
        windowTokens: 1_000_000,
        windowSource: 'other-conversation',
      });
      await third.page.getByTestId('context-pill').click();
      await expect(third.page.getByTestId('context-rows')).toContainText('Lida do histórico do Claude Code');
      expect(sha(file)).toBe(hashBefore); // ler a medição não abriu nem alterou a sessão
    } finally {
      await third?.app.close().catch(() => undefined);
      await second?.app.close().catch(() => undefined);
      await first.app.close().catch(() => undefined);
      removeUserData(userData);
      if (rootPath) fs.rmSync(projectDir(rootPath), { recursive: true, force: true });
    }
  });
});

test('cada mensagem, do usuário e do Claude, mostra o horário em que foi enviada', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await openConversation(page, TITLE.light);
    const times = page.getByTestId('message-time');
    const count =
      (await page.getByTestId('message-user').count()) + (await page.getByTestId('message-assistant').count());
    await expect(times).toHaveCount(count);
    // Formato curto (hora, "ontem 14:32" ou data) e a dica traz a data completa.
    await expect(times.first()).toHaveText(/^(ontem )?\d{2}:\d{2}$|^\d{2}\/\d{2}(\/\d{4})? \d{2}:\d{2}$/);
    await expect(times.first()).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    expect(await times.first().getAttribute('title')).toMatch(/\d{4}.*\d{2}:\d{2}:\d{2}/);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('sincronizar com o Claude Code: o botão existe e, sem novidade na sessão, diz que está em dia', async () => {
  const { app, page, userData } = await launchSeeded();
  try {
    await openConversation(page, TITLE.light);
    await expect(page.getByTestId('sync-button')).toBeEnabled();
    await page.getByTestId('sync-button').click();
    await expect(page.getByTestId('sync-result')).toHaveText('Já está em dia.');
    // Nada foi acrescentado à conversa.
    await expect(page.getByTestId('message-user')).toHaveCount(1);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test.describe('sincronizar com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 300_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };
  const cli = path.join(
    process.env.APPDATA ?? '',
    'npm',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );

  test('traz o que foi feito fora do Nexus, sem duplicar o que o próprio Nexus fez', async () => {
    test.skip(!fs.existsSync(cli), 'Claude Code (npm) não encontrado nesta máquina');
    const { app, page, userData } = await launchApp(undefined, options);
    let rootPath = '';
    try {
      const ws = await createWorkspace(page);
      rootPath = ws.rootPath;
      await page.reload();
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await expect(box).toBeEnabled({ timeout: 30_000 });
      await box.fill('Responda somente: ok-nexus-um');
      await box.press('Enter');
      await expect(page.getByTestId('message-assistant').last()).toContainText('ok-nexus-um', { timeout: 120_000 });

      // Alguém continua a MESMA sessão fora do Nexus (como o VS Code faz).
      const dir = path.join(os.homedir(), '.claude', 'projects', rootPath.replace(/[^a-zA-Z0-9]/g, '-'));
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const sessionId = files[0]!.replace(/\.jsonl$/, '');
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([k, v]) =>
            v !== undefined &&
            !k.startsWith('CLAUDE_CODE_') &&
            k !== 'CLAUDECODE' &&
            k !== 'ANTHROPIC_API_KEY' &&
            k !== 'ELECTRON_RUN_AS_NODE',
        ),
      ) as Record<string, string>;
      execFileSync(
        cli,
        ['-p', '--resume', sessionId, '--model', 'haiku', 'Pergunta feita fora do Nexus. Responda somente: ok-externo'],
        {
          cwd: rootPath,
          env,
          timeout: 120_000,
          stdio: 'ignore',
        },
      );

      // A tela ainda não sabe: continua com a única troca do Nexus.
      await expect(page.getByTestId('message-user')).toHaveCount(1);
      await page.getByTestId('sync-button').click();
      await expect(page.getByTestId('sync-result')).toHaveText('2 mensagens trazidas.');
      await expect(page.getByTestId('message-user')).toHaveCount(2);
      await expect(page.getByTestId('message-user').last()).toContainText('Pergunta feita fora do Nexus');
      await expect(page.getByTestId('message-assistant').last()).toContainText('ok-externo');

      // Sincronizar de novo não repete nada.
      await page.getByTestId('sync-button').click();
      await expect(page.getByTestId('sync-result')).toHaveText('Já está em dia.');
      await expect(page.getByTestId('message-user')).toHaveCount(2);

      // O Claude continua a conversa a partir do que veio de fora, e o turno do Nexus não é trazido de novo.
      await box.fill('Responda somente: ok-nexus-dois');
      await box.press('Enter');
      await expect(page.getByTestId('message-assistant').last()).toContainText('ok-nexus-dois', { timeout: 120_000 });
      await page.getByTestId('sync-button').click();
      await expect(page.getByTestId('sync-result')).toHaveText('Já está em dia.');
      await expect(page.getByTestId('message-user')).toHaveCount(3);
      await expect(page.getByTestId('message-assistant')).toHaveCount(3);
    } finally {
      await app.close();
      removeUserData(userData);
      if (rootPath) {
        fs.rmSync(path.join(os.homedir(), '.claude', 'projects', rootPath.replace(/[^a-zA-Z0-9]/g, '-')), {
          recursive: true,
          force: true,
        });
      }
    }
  });
});
