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
    // Fluxo de luz nas 3 rotas e cometas entre sistemas (há links entre sistemas diferentes); Leve: 1 cometa por vez.
    await expect(canvas).toHaveAttribute('data-flows', '3');
    await expect(canvas).toHaveAttribute('data-comets', '1');

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

test('modos Leve e Original: troca nas Configurações vale na hora, sem mexer na seleção nem nos planetas', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Modos');
    write(ws.knowledgeDir, 'Ideias/Roteiro.md', '# Roteiro\nVer [[Agenda]].\n');
    write(ws.knowledgeDir, 'Ideias/Agenda.md', '# Agenda\n');

    const panel = page.getByRole('complementary', { name: 'Painel lateral' });
    await panel.getByRole('tab', { name: 'Galáxia' }).click();
    const canvas = panel.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '2');
    // O Leve é o padrão, e o movimento ambiente (rotação, nebulosa, estrelas cadentes) está ligado.
    await expect(canvas).toHaveAttribute('data-quality', 'leve');
    await expect(canvas).toHaveAttribute('data-ambient', 'on');
    // Naves ambientais: 2 no Leve, 6 no Original.
    await expect(canvas).toHaveAttribute('data-ships', '2');

    // No Leve, o giro automático fica em no máximo 30 quadros por segundo (com folga para o relógio do teste).
    const frames = async () => Number((await canvas.getAttribute('data-frames')) ?? '0');
    await page.waitForTimeout(1500);
    const before = await frames();
    await page.waitForTimeout(3000);
    const drawn = (await frames()) - before;
    console.log(`modo Leve: ${drawn} quadros em 3 s com o giro automático`);
    expect(drawn).toBeLessThanOrEqual(3 * 30 + 15);

    const search = panel.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('roteiro');
    await search.press('Enter');
    await expect(canvas).toHaveAttribute('data-selected', 'Ideias/Roteiro.md');

    // Configurações com a galáxia aberta no painel: a troca vale na hora, sem recriar a cena.
    const settings = () =>
      page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Configurações' });
    await settings().click();
    const modes = page.getByRole('radiogroup', { name: 'Modo da galáxia' });
    await expect(modes.getByRole('radio', { name: /Leve/ })).toHaveAttribute('aria-checked', 'true');
    await modes.getByRole('radio', { name: /Original/ }).click();
    await expect(modes.getByRole('radio', { name: /Original/ })).toHaveAttribute('aria-checked', 'true');
    await expect(canvas).toHaveAttribute('data-quality', 'original');
    await expect(canvas).toHaveAttribute('data-ships', '6');
    await expect(canvas).toHaveAttribute('data-selected', 'Ideias/Roteiro.md');
    await expect(canvas).toHaveAttribute('data-planets', '2');

    // Fica guardado: depois de recarregar continua no Original; e volta ao Leve sem perder nada.
    await page.reload();
    await page.getByTestId('chat-view').waitFor();
    await panel.getByRole('tab', { name: 'Galáxia' }).click();
    await expect(canvas).toHaveAttribute('data-quality', 'original');
    await settings().click();
    await modes.getByRole('radio', { name: /Leve/ }).click();
    await expect(canvas).toHaveAttribute('data-quality', 'leve');
    await expect(canvas).toHaveAttribute('data-planets', '2');
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
    await card.getByRole('button', { name: 'Voltar ao automático' }).click();
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

test('movimento reduzido: sem movimento ambiente, a galáxia só desenha quando algo muda', async () => {
  const { app, page, userData } = await launchApp();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ws = await createWorkspace(page, 'Quieta');
    write(ws.knowledgeDir, 'Ideias/Roteiro.md', '# Roteiro\nVer [[Agenda]].\n');
    write(ws.knowledgeDir, 'Ideias/Agenda.md', '# Agenda\n');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '2');
    await expect(canvas).toHaveAttribute('data-ambient', 'off');
    const frames = async () => Number((await canvas.getAttribute('data-frames')) ?? '0');
    await page.waitForTimeout(1500);
    const before = await frames();
    await page.waitForTimeout(2500);
    expect((await frames()) - before).toBeLessThanOrEqual(2);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('nota alterada por fora pulsa na galáxia', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Pulsos');
    write(ws.knowledgeDir, 'Ideias/Roteiro.md', '# Roteiro\nVer [[Agenda]].\n');
    write(ws.knowledgeDir, 'Ideias/Agenda.md', '# Agenda\n');
    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '2');
    // Eventos da criação das notas acima ainda podem chegar: conta a partir de quando a galáxia sossega
    // (e depois do intervalo mínimo entre dois pulsos da mesma nota).
    await page.waitForTimeout(4500);
    const pulses = async () => Number((await canvas.getAttribute('data-pulses')) ?? '0');
    const before = await pulses();
    write(ws.knowledgeDir, 'Ideias/Agenda.md', '# Agenda\nAtualizada.\n');
    await expect.poll(pulses).toBe(before + 1);
    write(ws.knowledgeDir, 'Ideias/Nova.md', '# Nova\n');
    await expect(canvas).toHaveAttribute('data-planets', '3');
    await expect.poll(pulses).toBe(before + 2);
    // Nada disso foi o Claude: nenhuma nave de atividade.
    await expect(canvas).toHaveAttribute('data-activity-ships', '0');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

// Com o Claude Code real (modelo Haiku, uma mensagem curta): a nave do Claude vai até a nota que ele cria.
test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 180_000 });

  test('o Claude criando uma nota manda uma nave até ela e o planeta pulsa', async () => {
    const { app, page, userData } = await launchApp(undefined, {
      claude: 'real',
      env: { NEXUS_CLAUDE_MODEL: 'haiku' },
    });
    try {
      const ws = await createWorkspace(page, 'Nave');
      write(ws.knowledgeDir, 'Ideias/Roteiro.md', '# Roteiro\n');
      const panel = page.getByRole('complementary', { name: 'Painel lateral' });
      await panel.getByRole('tab', { name: 'Galáxia' }).click();
      const canvas = panel.getByTestId('galaxy-canvas');
      await expect(canvas).toHaveAttribute('data-planets', '1');
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await expect(box).toBeEnabled({ timeout: 30_000 });
      const file = path.join(ws.knowledgeDir, 'Ideias', 'Teste da nave.md');
      await box.fill(
        `Use a ferramenta Write para criar o arquivo "${file}" com o conteúdo "# Teste da nave". Depois responda só "ok".`,
      );
      await box.press('Enter');
      await expect(canvas).toHaveAttribute('data-activity-ships', '1', { timeout: 120_000 });
      await expect(canvas).toHaveAttribute('data-planets', '2', { timeout: 60_000 });
      await expect(canvas).toHaveAttribute('data-pulses', '1', { timeout: 30_000 });
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});

test('aparência automática: nota com código vira planeta metálico; a escolha manual vale até voltar ao automático', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Automático');
    const fence = '```';
    write(
      ws.knowledgeDir,
      'Dev/Script.md',
      `# Script\n${fence}ts\nconst a = 1;\n${fence}\n${fence}\nb\n${fence}\nTexto. ${'x '.repeat(400)}\n`,
    );
    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '1');
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('script');
    await search.press('Enter');
    const card = page.getByRole('region', { name: 'Planeta selecionado' });
    await card.getByRole('button', { name: 'Editar planeta' }).click();
    const kind = card.getByLabel('Tipo do planeta');
    await expect(kind).toHaveValue('metalico');
    await expect(card.getByTestId('planet-auto')).toBeVisible();

    // Escolha manual: vale mesmo que a nota continue com código.
    await kind.selectOption('gelo');
    await expect(card.getByRole('button', { name: 'Voltar ao automático' })).toBeVisible();
    write(ws.knowledgeDir, 'Dev/Script.md', `# Script\n${fence}\nc\n${fence}\n${fence}\nd\n${fence}\nMudou.\n`);
    await page.waitForTimeout(1500);
    await expect(kind).toHaveValue('gelo');

    await card.getByRole('button', { name: 'Voltar ao automático' }).click();
    await expect(kind).toHaveValue('metalico');
    await expect(card.getByTestId('planet-auto')).toBeVisible();
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('luas: anexos incorporados orbitam o planeta e aparecem no cartão; anexo que sumiu avisa', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Luas');
    write(ws.knowledgeDir, 'Contratos/Fornecedor.md', '# Fornecedor\n![[contrato.pdf]]\n![[foto.png]]\n![[sumiu.pdf]]\n');
    write(ws.knowledgeDir, 'Contratos/contrato.pdf', 'x');
    write(ws.knowledgeDir, 'Contratos/foto.png', 'x');
    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '1');
    await expect(canvas).toHaveAttribute('data-moons', '3');
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('fornecedor');
    await search.press('Enter');
    const moons = page.getByTestId('planet-moons');
    await expect(moons).toContainText('3 anexos');
    await expect(moons.getByRole('button', { name: 'contrato.pdf', exact: true })).toBeVisible();
    await moons.getByRole('button', { name: 'sumiu.pdf', exact: true }).click();
    await expect(moons.getByRole('alert')).toContainText('não foi encontrado');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('busca visual: notas encontradas acendem, o resto apaga, #tag filtra e "Enquadrar" mostra todas', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Busca');
    write(ws.knowledgeDir, 'Fiscal/ST.md', '# ST\n#fiscal #urgente\n');
    write(ws.knowledgeDir, 'Fiscal/CEST.md', '# CEST\n#fiscal\n');
    write(ws.knowledgeDir, 'Contas/Fechamento.md', '# Fechamento\n#urgente\n');
    write(ws.knowledgeDir, 'Ideias.md', '# Ideias\n');
    await openGalaxy(page);
    const canvas = page.getByTestId('galaxy-canvas');
    await expect(canvas).toHaveAttribute('data-planets', '4');
    const search = page.getByRole('combobox', { name: 'Buscar nota na galáxia' });
    await search.fill('#fiscal');
    await expect(canvas).toHaveAttribute('data-search-matches', '2');
    await expect(page.getByTestId('search-count')).toHaveText('2 notas acesas na galáxia');
    await search.fill('#urgente fe');
    await expect(canvas).toHaveAttribute('data-search-matches', '1');
    await search.fill('#urgente');
    await page.getByRole('button', { name: 'Enquadrar' }).click();
    await expect(canvas).toHaveAttribute('data-flying', 'false', { timeout: 5000 });
    await expect(canvas).toHaveAttribute('data-search-matches', '2');
    // Nota alterada com a busca aberta: a cena é refeita e a busca continua valendo.
    write(ws.knowledgeDir, 'Contas/Fechamento.md', '# Fechamento\n#urgente\nMais texto.\n');
    await page.waitForTimeout(1500);
    await expect(canvas).toHaveAttribute('data-search-matches', '2');
    await search.press('Escape');
    await expect(canvas).toHaveAttribute('data-search-matches', '');
  } finally {
    await app.close();
    removeUserData(userData);
  }
});
