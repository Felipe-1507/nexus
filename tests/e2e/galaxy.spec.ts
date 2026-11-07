import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Galáxia (Etapa 11).

async function createWorkspace(page: Page, name: string): Promise<{ id: string; knowledgeDir: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; knowledgeDir: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

function write(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

const openGalaxy = (page: Page) =>
  page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Galáxia' }).click();

test('galáxia do vault: sistemas, rotas, busca, clique abre a nota e atualização ao vivo', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Universo');
    const vault = ws.knowledgeDir;
    write(
      vault,
      'Trabalho/Conciliação bancária.md',
      '# Conciliação bancária\nVer [[Bancos]] e [[Ideias]]. #trabalho\n',
    );
    write(vault, 'Trabalho/Bancos.md', '# Bancos\nUsado na [[Conciliação bancária]].\n');
    write(vault, 'Ideias.md', '# Ideias\n');
    write(vault, 'Pessoal/Leituras.md', '# Leituras\n[[Ideias]] e [[Nota que não existe]]\n');

    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-ready', 'true');
    // Núcleo (notas soltas) + Trabalho + Pessoal; o link de ida e volta conta uma rota só.
    await expect(canvas).toHaveAttribute('data-planets', '4');
    await expect(canvas).toHaveAttribute('data-routes', '3');
    await expect(canvas).toHaveAttribute('data-systems', '3');
    await expect(page.getByTestId('galaxy-stats')).toHaveText('4 notas · 3 rotas');

    // Busca sem acento leva a câmera até o planeta.
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('conciliacao');
    await expect(page.getByRole('option', { name: /Conciliação bancária/ })).toBeVisible();
    await search.press('Enter');
    await expect(canvas).toHaveAttribute('data-selected', 'Trabalho/Conciliação bancária.md');
    await expect(page.getByRole('region', { name: 'Planeta selecionado' })).toContainText('Trabalho · 2 conexões');
    await expect(canvas).toHaveAttribute('data-flying', 'false');

    // Com a câmera no planeta, ele está no centro da tela: clicar ali abre a nota no painel direito.
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const panel = page.getByRole('complementary', { name: 'Painel lateral' });
    await expect(panel.getByRole('tab', { name: 'Nota' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { name: 'Conciliação bancária', level: 1 })).toBeVisible();

    // Nota nova criada por fora (pelo Claude, por exemplo) aparece sem recarregar.
    write(vault, 'Trabalho/Impostos.md', '# Impostos\nDepende de [[Bancos]].\n');
    await expect(canvas).toHaveAttribute('data-planets', '5');
    await expect(canvas).toHaveAttribute('data-routes', '4');
    await expect(canvas).toHaveAttribute('data-selected', 'Trabalho/Conciliação bancária.md');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('galáxia na aba do painel, ao lado do chat: clique seleciona, "Abrir nota" abre', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Lado a lado');
    write(ws.knowledgeDir, 'Ideias/Roteiro.md', '# Roteiro\nVer [[Agenda]].\n');
    write(ws.knowledgeDir, 'Ideias/Agenda.md', '# Agenda\n');

    const panel = page.getByRole('complementary', { name: 'Painel lateral' });
    await panel.getByRole('tab', { name: 'Galáxia' }).click();
    const canvas = panel.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '2');
    await expect(panel.getByTestId('galaxy-view')).toHaveAttribute('data-mode', 'panel');
    await expect(page.getByTestId('chat-view')).toBeVisible();

    const search = panel.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('roteiro');
    await search.press('Enter');
    await expect(canvas).toHaveAttribute('data-flying', 'false');
    // No painel, clicar no planeta só seleciona: a aba continua na galáxia.
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(canvas).toHaveAttribute('data-selected', 'Ideias/Roteiro.md');
    await expect(panel.getByRole('tab', { name: 'Galáxia' })).toHaveAttribute('aria-selected', 'true');

    await panel
      .getByRole('region', { name: 'Planeta selecionado' })
      .getByRole('button', { name: 'Abrir nota' })
      .click();
    await expect(panel.getByRole('tab', { name: 'Nota' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { name: 'Roteiro', level: 1 })).toBeVisible();

    // Com a galáxia na tela principal, a aba dela some do painel em vez de abrir uma segunda.
    await openGalaxy(page);
    await expect(panel.getByRole('tab', { name: 'Galáxia' })).toHaveCount(0);
    await expect(panel.getByRole('tab', { name: 'Código' })).toBeVisible();
    await expect(page.getByTestId('galaxy-canvas')).toHaveCount(1);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('planetas: o tamanho acompanha o conteúdo e a aparência pode ser editada e fica guardada', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Planetas');
    write(ws.knowledgeDir, 'Curta.md', '# Curta\n');
    write(ws.knowledgeDir, 'Longa.md', `# Longa\n${'conteúdo '.repeat(3000)}`);

    // O grafo informa o tamanho de cada nota, e o planeta da nota longa é maior.
    const graph = (await page.evaluate((id) => window.nexus.invoke('knowledge:graph', { workspaceId: id }), ws.id)) as {
      data: { notes: Array<{ path: string; chars: number }> };
    };
    const chars = Object.fromEntries(graph.data.notes.map((n) => [n.path, n.chars]));
    expect(chars['Longa.md']).toBeGreaterThan(chars['Curta.md']! * 100);

    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '2');
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('longa');
    await search.press('Enter');
    const card = page.getByRole('region', { name: 'Planeta selecionado' });
    await expect(card).toContainText('Longa');

    // Edita: tipo, cor, anéis, atmosfera e uma anotação.
    await card.getByRole('button', { name: 'Editar planeta' }).click();
    const editor = card.getByTestId('planet-editor');
    await editor.getByLabel('Tipo do planeta').selectOption('lava');
    await editor.getByLabel('Cor do planeta').fill('#00aaff');
    await editor.getByLabel('Anéis').check();
    await editor.getByLabel('Atmosfera').uncheck();
    await editor.getByLabel('Anotação do planeta').fill('Planeta principal do projeto');
    await expect(card.getByTestId('planet-detail')).toHaveText('Planeta principal do projeto');

    // Fica guardado no vault, só com o que foi trocado, num arquivo oculto (não vira nota).
    const file = path.join(ws.knowledgeDir, '.planetas.json');
    await expect
      .poll(() => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))['Longa.md'] : null))
      .toMatchObject({
        kind: 'lava',
        color: '#00aaff',
        ring: true,
        atmosphere: false,
        detail: 'Planeta principal do projeto',
      });
    await expect(canvas).toHaveAttribute('data-planets', '2');

    // Sobrevive ao recarregamento; "voltar ao aleatório" apaga as escolhas.
    await page.reload();
    await openGalaxy(page);
    await expect(canvas).toHaveAttribute('data-planets', '2');
    await search.fill('longa');
    await search.press('Enter');
    await expect(card.getByTestId('planet-detail')).toHaveText('Planeta principal do projeto');
    await card.getByRole('button', { name: 'Editar planeta' }).click();
    await card.getByRole('button', { name: 'Voltar ao aleatório' }).click();
    await expect(card.getByTestId('planet-detail')).toHaveCount(0);
    await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({});

    // Valores inválidos são recusados pelo main.
    const bad = await page.evaluate((a) => window.nexus.invoke('galaxy:setPlanet', a), {
      workspaceId: ws.id,
      path: 'Longa.md',
      override: { kind: 'estrela' },
    } as never);
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('vault vazio mostra a galáxia vazia, sem dados de exemplo', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await createWorkspace(page, 'Vazio');
    await openGalaxy(page);
    await expect(page.getByTestId('galaxy-view')).toContainText('Sua galáxia está vazia');
    await expect(page.getByTestId('galaxy-canvas')).toHaveAttribute('data-planets', '0');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('desempenho: um vault de 1.200 notas abre rápido e a navegação continua fluida', async () => {
  test.setTimeout(120_000);
  // O vault já existe quando o app abre, como no uso real (escrever 1.200 arquivos com o app aberto mede o watcher).
  const first = await launchApp();
  const { userData } = first;
  let { app, page } = first;
  try {
    const ws = await createWorkspace(page, 'Grande');
    await app.close();
    const total = 1_200;
    for (let i = 0; i < total; i++) {
      const links = [`Nota ${(i + 1) % total}`, `Nota ${(i * 7 + 3) % total}`, `Nota ${(i * 13) % 97}`];
      write(
        ws.knowledgeDir,
        `Pasta ${i % 12}/Nota ${i}.md`,
        `# Nota ${i}\n${links.map((l) => `[[${l}]]`).join(' ')}\n`,
      );
    }
    // 1ª abertura: arquivos recém-criados passam pelo antivírus do Windows na primeira leitura (só informativo).
    ({ app, page } = await launchApp(userData));
    let started = Date.now();
    await openGalaxy(page);
    let canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', String(total), { timeout: 60_000 });
    const firstReadMs = Date.now() - started;
    await app.close();

    // Uso real: o app reinicia com um vault que já existe e, alguns segundos depois, a galáxia é aberta (com o app
    // ocioso, o Nexus já adiantou o código da galáxia e o grafo).
    ({ app, page } = await launchApp(userData));
    await page.waitForTimeout(6_000);
    started = Date.now();
    await openGalaxy(page);
    canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', String(total), { timeout: 30_000 });
    const openMs = Date.now() - started;

    // Quadros por segundo com a galáxia girando (a rotação automática redesenha a cada quadro). A janela do teste
    // pode estar coberta por outras na tela, e o Chromium reduz a 1 quadro por segundo uma janela que não aparece.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setBackgroundThrottling(false),
    );
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const t0 = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - t0 < 2_000) requestAnimationFrame(tick);
            else resolve((frames * 1_000) / (performance.now() - t0));
          };
          requestAnimationFrame(tick);
        }),
    );
    const summary = `primeira leitura ${firstReadMs} ms · abrir ${openMs} ms · ${fps.toFixed(0)} fps`;
    test.info().annotations.push({ type: 'desempenho', description: summary });
    console.log(`galáxia com ${total} notas: ${summary}`);
    expect(openMs).toBeLessThan(1_500);
    expect(fps).toBeGreaterThan(30);

    // A busca continua instantânea.
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('nota 777');
    await search.press('Enter');
    await expect(canvas).toHaveAttribute('data-selected', 'Pasta 9/Nota 777.md');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
