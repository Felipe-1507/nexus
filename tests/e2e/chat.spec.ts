import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData, tempUserData } from './launch';

// Chat (Etapa 5).

async function createWorkspace(page: Page, name: string): Promise<string> {
  const ws = await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  );
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return (ws as { ok: true; data: { rootPath: string } }).data.rootPath;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Mensagem' });
const lastAnswer = (page: Page) => page.getByTestId('message-assistant').last();

test('sem Claude Code, o Workspace mostra o passo a passo para conectar e o campo fica bloqueado', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await createWorkspace(page, 'Sem Claude');
    await expect(page.getByTestId('chat-view').getByRole('heading', { name: 'Sem Claude' })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
    await expect(page.getByTestId('chat-view').getByTestId('connect-claude')).toContainText('Instale o Claude Code');
    await expect(page.getByRole('list', { name: 'Lista de conversas' })).toBeEmpty();
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

// Conversas reais com o Claude Code desta máquina (modelo Haiku, mensagens curtas).
test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let app: ElectronApplication;
  let page: Page;
  let userData: string;
  let root: string;
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  test.beforeAll(async () => {
    userData = tempUserData();
    ({ app, page } = await launchApp(userData, options));
    root = await createWorkspace(page, 'Teste Real');
    fs.writeFileSync(path.join(root, 'nota.md'), '# Nota\n\nO código secreto é 4721.\n');
    await expect(composer(page)).toBeEnabled({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    await app?.close();
    removeUserData(userData);
  });

  test('"aviso quando terminar": o resultado de uma tarefa em segundo plano aparece na conversa, sozinho', async () => {
    const box = composer(page);
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await box.fill(
      'Use a ferramenta Bash com o parâmetro run_in_background definido como true para rodar `sleep 25 && echo FIM-DO-TESTE-7421`. NÃO espere o comando terminar: assim que ele estiver rodando em segundo plano, encerre a sua resposta escrevendo só "Rodando.". Quando o sistema avisar que o comando terminou, escreva só "Terminou: " seguido do que ele imprimiu.',
    );
    await box.press('Enter');
    await expect(lastAnswer(page)).toContainText('Rodando', { timeout: 120_000 });
    await expect(lastAnswer(page)).not.toContainText('FIM-DO-TESTE-7421');
    // Sem o usuário fazer nada, a segunda resposta (do aviso de término) aparece sozinha.
    await expect(page.getByTestId('message-assistant')).toHaveCount(2, { timeout: 120_000 });
    await expect(lastAnswer(page)).toContainText('FIM-DO-TESTE-7421');
  });

  test('lê um arquivo do Workspace e mostra só a resposta final', async () => {
    await composer(page).fill('Leia o arquivo nota.md e me diga qual é o código secreto. Responda só o número.');
    await composer(page).press('Enter');

    await expect(page.getByTestId('message-user')).toContainText('nota.md');
    await expect(page.getByTestId('message-live')).toBeVisible();
    await expect(lastAnswer(page)).toContainText('4721', { timeout: 120_000 });
    await expect(page.getByTestId('message-live')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Lista de conversas' }).getByRole('listitem')).toHaveCount(1);

    await lastAnswer(page)
      .getByRole('button', { name: /Ver detalhes/ })
      .click();
    await expect(lastAnswer(page).getByTestId('message-details')).toContainText('Leu nota.md');
  });

  test('a conversa sobrevive ao reinício e continua com o mesmo contexto', async () => {
    await app.close();
    ({ app, page } = await launchApp(userData, options));
    await page.getByRole('list', { name: 'Lista de conversas' }).getByRole('button').first().click();
    await expect(page.getByTestId('message-assistant')).toHaveCount(1);
    await expect(composer(page)).toBeEnabled({ timeout: 30_000 });

    await composer(page).fill('Qual número você me respondeu na mensagem anterior? Responda só o número.');
    await composer(page).press('Enter');
    await expect(page.getByTestId('message-assistant')).toHaveCount(2, { timeout: 120_000 });
    await expect(lastAnswer(page)).toContainText('4721');
  });

  test('renomear a conversa (duplo clique, Enter) e o nome continua após reiniciar', async () => {
    const list = page.getByRole('list', { name: 'Lista de conversas' });
    await list.getByRole('button').first().dblclick();
    const input = list.getByRole('textbox', { name: /Novo nome da conversa/ });
    await input.fill('Código secreto da nota');
    await input.press('Enter');
    await expect(list.getByRole('button', { name: 'Código secreto da nota', exact: true })).toBeVisible();

    // Esc cancela sem trocar o nome.
    await list.getByRole('button').first().dblclick();
    await list.getByRole('textbox', { name: /Novo nome da conversa/ }).fill('Descartado');
    await page.keyboard.press('Escape');
    await expect(list.getByRole('button', { name: 'Código secreto da nota', exact: true })).toBeVisible();

    await app.close();
    ({ app, page } = await launchApp(userData, options));
    await expect(
      page
        .getByRole('list', { name: 'Lista de conversas' })
        .getByRole('button', { name: 'Código secreto da nota', exact: true }),
    ).toBeVisible();
  });

  test('somente leitura: não cria arquivos', async () => {
    // O padrão é Auto; o modo muda no meio da conversa (o processo reinicia e a conversa continua).
    await page.evaluate(async () => {
      const list = (await window.nexus.invoke('workspaces:list')) as { ok: true; data: { activeId: string } };
      await window.nexus.invoke('workspaces:setPermissionMode', { id: list.data.activeId, mode: 'read_only' });
    });
    await composer(page).fill('Crie o arquivo teste.txt com o texto "oi". Se não conseguir, responda só: não consigo.');
    await composer(page).press('Enter');
    await expect(page.getByTestId('message-assistant')).toHaveCount(3, { timeout: 120_000 });
    expect(fs.existsSync(path.join(root, 'teste.txt'))).toBe(false);
  });

  test('parar interrompe a resposta e mantém o que já foi escrito', async () => {
    await composer(page).fill('Escreva os números de 1 a 500 por extenso, um por linha, sem mais nada.');
    await composer(page).press('Enter');
    await expect(page.getByTestId('message-live').locator('.md')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Parar resposta' }).click();

    await expect(page.getByTestId('message-assistant')).toHaveCount(4, { timeout: 30_000 });
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
    await expect(lastAnswer(page)).toContainText('Resposta interrompida');
    await expect(composer(page)).toBeEnabled();
  });

  test('durante a resposta: "Ver detalhes" ao vivo e fila de mensagens', async () => {
    // Uma conversa nova, para a ordem das mensagens ser fácil de conferir.
    await page.getByRole('button', { name: 'Nova conversa' }).first().click();
    await composer(page).fill('Leia o arquivo nota.md e responda só com o número do código secreto.');
    await composer(page).press('Enter');

    // Sem esperar a resposta: o botão e o relógio já estão lá, e dá para escrever a próxima mensagem.
    const live = page.getByTestId('message-live');
    await expect(live.getByRole('button', { name: /Ver detalhes/ })).toBeVisible();
    await expect(live.getByTestId('live-status')).toContainText('Trabalhando há');
    await expect(composer(page)).toBeEnabled();
    await composer(page).fill('Agora diga só a palavra: pronto');
    await composer(page).press('Enter');
    await expect(page.getByTestId('message-queue')).toContainText('Agora diga só a palavra: pronto');

    // A primeira resposta termina, a fila anda sozinha e a segunda resposta vem depois, na ordem.
    await expect(page.getByTestId('message-user')).toHaveCount(2, { timeout: 120_000 });
    await expect(page.getByTestId('message-assistant').nth(0)).toContainText('4721', { timeout: 120_000 });
    await expect(page.getByTestId('message-assistant').nth(1)).toContainText(/pronto/i, { timeout: 120_000 });
    await expect(page.getByTestId('message-queue')).toHaveCount(0);
    await expect(page.getByTestId('message-live')).toHaveCount(0);
  });

  test('copiar, editar, link de arquivo na resposta e medidor de uso do plano', async () => {
    await page.getByRole('button', { name: 'Nova conversa' }).first().click();
    fs.writeFileSync(path.join(root, 'leia.txt'), 'conteúdo do arquivo linkado\n');
    const target = `${root.replace(/\\/g, '/')}/leia.txt`;
    const prompt = `Responda somente com este texto exato, sem alterar nada: [veja aqui](${target})`;
    await composer(page).fill(prompt);
    await composer(page).press('Enter');

    // O medidor do plano mostra a sessão de 5 horas e a semana, com porcentagem e hora do reinício.
    const meter = page.getByTestId('usage-meter');
    await expect(meter).toBeVisible({ timeout: 60_000 });
    await expect(meter.getByTestId('usage-five_hour')).toContainText('%');
    await expect(meter.getByTestId('usage-five_hour')).toContainText('reinicia');
    await expect(meter.getByTestId('usage-seven_day')).toContainText('%');

    // Link de arquivo na resposta: clicar abre o arquivo de texto no próprio Nexus (aba Código).
    const answer = lastAnswer(page);
    const link = answer.locator('a.file-link');
    await expect(link).toBeVisible({ timeout: 120_000 });
    await link.click();
    await expect(page.getByTestId('code-file')).toContainText('leia.txt');
    await expect(page.getByTestId('code-file').locator('.monaco-editor .view-lines')).toContainText(
      'conteúdo do arquivo linkado',
    );

    // Copiar a resposta do Claude.
    await answer.hover();
    await answer.getByRole('button', { name: 'Copiar resposta' }).click();
    await expect(answer.getByRole('button', { name: 'Copiar resposta' })).toContainText('Copiado');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain('veja aqui');

    // Copiar e editar a própria mensagem: o texto volta ao campo para mudar e reenviar.
    const mine = page.getByTestId('message-user').last();
    await mine.hover();
    await mine.getByRole('button', { name: 'Copiar mensagem' }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      'Responda somente com este texto exato',
    );
    await mine.getByRole('button', { name: 'Editar mensagem' }).click();
    await expect(composer(page)).toHaveValue(prompt);
    await expect(composer(page)).toBeFocused();

    // Um link para fora das pastas do Workspace é recusado, sem abrir nada.
    const refused = await page.evaluate(
      (t) => window.nexus.invoke('code:openLink', { workspaceId: t.ws, projectId: null, target: 'C:/Windows/win.ini' }),
      {
        ws: ((await page.evaluate(() => window.nexus.invoke('workspaces:list'))) as { data: { activeId: string } }).data
          .activeId,
      },
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
