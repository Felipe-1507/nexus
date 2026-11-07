import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, removeUserData } from './launch';

// Anexos no chat (Etapa 12.3): o que o main aceita e recusa, sem gastar a cota do plano.

async function createWorkspace(page: Page, name: string): Promise<{ id: string; rootPath: string }> {
  const r = (await page.evaluate(
    (n) => window.nexus.invoke('workspaces:create', { name: n, color: 'violet', icon: 'layers' }),
    name,
  )) as { ok: true; data: { id: string; rootPath: string } };
  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  return r.data;
}

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('anexos: guarda no Workspace, confere o conteúdo e recusa o que não é imagem ou PDF', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Anexos');
    const save = (name: string, mime: string, data: string) =>
      page.evaluate((a) => window.nexus.invoke('attachments:save', a), {
        workspaceId: ws.id,
        name,
        mime,
        data,
      } as never);

    const ok = (await save('print.png', 'image/png', PNG_1X1)) as {
      ok: true;
      data: { id: string; name: string; mime: string; size: number };
    };
    expect(ok).toMatchObject({ ok: true, data: { name: 'print.png', mime: 'image/png' } });
    expect(fs.existsSync(path.join(ws.rootPath, '.nexus', 'anexos', `${ok.data.id}.png`))).toBe(true);

    const thumb = (await page.evaluate((a) => window.nexus.invoke('attachments:thumb', a), {
      workspaceId: ws.id,
      attachment: ok.data,
    } as never)) as { ok: true; data: { dataUrl: string | null } };
    expect(thumb.data.dataUrl).toMatch(/^data:image\/png;base64,/);

    // Um executável com nome e tipo de imagem não passa: o conteúdo é conferido.
    const fake = Buffer.from('MZ\x90\x00programa').toString('base64');
    expect(await save('virus.png', 'image/png', fake)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    // Tipo fora da lista é recusado antes de chegar ao serviço.
    expect(await save('a.exe', 'application/x-msdownload', fake)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    // O id vem do main: um id forjado não abre nenhum arquivo.
    const forged = await page.evaluate((a) => window.nexus.invoke('attachments:thumb', a), {
      workspaceId: ws.id,
      attachment: { id: '99999999-9999-4999-8999-999999999999', name: 'x.png', mime: 'image/png', size: 1 },
    } as never);
    expect(forged).toMatchObject({ ok: true, data: { dataUrl: null } });
    // Só anexo, sem texto, é uma mensagem válida; sem texto e sem anexo, não.
    const empty = await page.evaluate((a) => window.nexus.invoke('chat:send', a), {
      workspaceId: ws.id,
      text: '',
    } as never);
    expect(empty).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test('limpeza: Configurações mostra o espaço usado e apaga só os anexos antigos', async () => {
  const { app, page, userData } = await launchApp();
  try {
    const ws = await createWorkspace(page, 'Limpeza');
    const save = async () =>
      (
        (await page.evaluate((a) => window.nexus.invoke('attachments:save', a), {
          workspaceId: ws.id,
          name: 'print.png',
          mime: 'image/png',
          data: PNG_1X1,
        } as never)) as { data: { id: string } }
      ).data.id;
    const dir = path.join(ws.rootPath, '.nexus', 'anexos');
    const recent = await save();
    const old = await save();
    const when = new Date(Date.now() - 120 * 86_400_000);
    fs.utimesSync(path.join(dir, `${old}.png`), when, when);

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Configurações' })
      .click();
    const section = page.getByTestId('attachments-section');
    await expect(section.getByTestId('attachments-usage')).toContainText('2 arquivos');

    await section.getByRole('button', { name: /Apagar anexos com mais de 90 dias/ }).click();
    await expect(section.getByRole('status')).toContainText('1 arquivo apagado');
    await expect(section.getByTestId('attachments-usage')).toContainText('1 arquivo');
    expect(fs.existsSync(path.join(dir, `${old}.png`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${recent}.png`))).toBe(true);

    // Sem nada com mais de 90 dias, avisa e não apaga nada.
    await section.getByRole('button', { name: /Apagar anexos com mais de 90 dias/ }).click();
    await expect(section.getByRole('status')).toContainText('Nenhum anexo com mais de 90 dias');
    expect(fs.existsSync(path.join(dir, `${recent}.png`))).toBe(true);
  } finally {
    await app.close();
    removeUserData(userData);
  }
});

test.describe('com o Claude Code real', () => {
  test.skip(process.env.NEXUS_LIVE_TESTS !== '1', 'gasta cota do plano; rode com NEXUS_LIVE_TESTS=1');
  test.describe.configure({ timeout: 180_000 });
  const options = { claude: 'real' as const, env: { NEXUS_CLAUDE_MODEL: 'haiku' } };

  test('cola uma imagem no campo, envia, e o Claude lê o que está escrito nela', async () => {
    const { app, page, userData } = await launchApp(undefined, options);
    try {
      const ws = await createWorkspace(page, 'Imagem');
      const box = page.getByRole('textbox', { name: 'Mensagem' });
      await expect(box).toBeEnabled({ timeout: 30_000 });

      // Uma imagem com uma palavra escrita, desenhada na própria página, colada como um print de tela.
      await box.focus();
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 160;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 480, 160);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 64px sans-serif';
        ctx.fillText('ABACAXI', 40, 100);
        const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
        const data = new DataTransfer();
        data.items.add(new File([blob], 'print.png', { type: 'image/png' }));
        document
          .querySelector('textarea[aria-label="Mensagem"]')!
          .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });

      const chips = page.getByTestId('composer-attachments');
      await expect(chips.getByTestId('attachment')).toHaveCount(1);
      await expect(chips.locator('img')).toBeVisible();
      expect(fs.readdirSync(path.join(ws.rootPath, '.nexus', 'anexos'))).toHaveLength(1);

      await box.fill('Que palavra está escrita na imagem? Responda só a palavra.');
      await box.press('Enter');

      await expect(page.getByTestId('message-user').getByTestId('message-attachments')).toBeVisible();
      await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
      await expect(page.getByTestId('message-assistant').last()).toContainText(/abacaxi/i, { timeout: 120_000 });
    } finally {
      await app.close();
      removeUserData(userData);
    }
  });
});
