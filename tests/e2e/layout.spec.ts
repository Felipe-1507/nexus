import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, removeUserData, setWindowSize } from './launch';

// Interface base (Etapa 2): painéis, navegação, tema e responsividade.
let app: ElectronApplication;
let page: Page;
let userData: string;

const sidebar = () => page.getByRole('navigation', { name: 'Navegação principal' });
const rightPanel = () => page.getByRole('complementary', { name: 'Painel lateral' });
const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeAll(async () => {
  ({ app, page, userData } = await launchApp());
  await setWindowSize(app, 1440, 900);
});

test.afterAll(async () => {
  await app?.close();
  removeUserData(userData);
});

test('mostra os três painéis com estados vazios reais', async () => {
  await expect(sidebar()).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(rightPanel()).toBeVisible();
  await expect(sidebar()).toContainText('Nenhum Workspace ainda');
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Nenhum Workspace');
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
  await expect(rightPanel()).toContainText('Nenhuma nota aberta');
});

test('atalhos e botões recolhem os painéis', async () => {
  await page.keyboard.press('Control+B');
  await expect(sidebar()).toBeHidden();
  await page.keyboard.press('Control+B');
  await expect(sidebar()).toBeVisible();

  await page.getByRole('button', { name: /Alternar painel lateral/ }).click();
  await expect(rightPanel()).toBeHidden();
  await page.keyboard.press('Control+Alt+B');
  await expect(rightPanel()).toBeVisible();
});

test('abas do painel lateral trocam o conteúdo', async () => {
  await page.getByRole('tab', { name: 'Código' }).click();
  await expect(page.getByRole('tab', { name: 'Código' })).toHaveAttribute('aria-selected', 'true');
  await expect(rightPanel()).toContainText('Nenhum arquivo aberto');
  await page.getByRole('tab', { name: 'Galáxia' }).click();
  await expect(rightPanel()).toContainText('Nenhum Workspace aberto');
  await page.getByRole('tab', { name: 'Nota' }).click();
});

test('navega para Configurações e volta', async () => {
  await sidebar().getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await expect(page.getByTestId('app-status')).toContainText(/schema v\d+/);
  await expect(page.getByTestId('settings-view')).toContainText(userData);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chat-view')).toBeVisible();

  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await sidebar().getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByTestId('chat-view')).toBeVisible();
});

test('divisor ajusta a largura pelo teclado e ela sobrevive a um recarregamento', async () => {
  const separator = page.getByRole('separator', { name: 'Redimensionar barra lateral' });
  const before = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(before + 16));

  await page.reload();
  await page.getByTestId('chat-view').waitFor();
  await expect(page.getByRole('separator', { name: 'Redimensionar barra lateral' })).toHaveAttribute(
    'aria-valuenow',
    String(before + 16),
  );
});

test('arrastar o painel direito além do espaço disponível não o faz sumir', async () => {
  const separator = page.getByRole('separator', { name: 'Redimensionar painel lateral' });
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(40, box.y + 200, { steps: 8 });
  await page.mouse.up();

  await expect(rightPanel()).toBeVisible();
  const max = Number(await separator.getAttribute('aria-valuemax'));
  await expect(separator).toHaveAttribute('aria-valuenow', String(max));
  const chatWidth = await page.getByTestId('chat-view').evaluate((el) => el.getBoundingClientRect().width);
  expect(chatWidth).toBeGreaterThanOrEqual(480);

  // Duplo clique volta à largura padrão.
  const after = (await separator.boundingBox())!;
  await page.mouse.dblclick(after.x + 1, after.y + 200);
  await expect(separator).toHaveAttribute('aria-valuenow', '380');
});

test('janela estreita esconde o painel direito sem rolagem horizontal', async () => {
  await setWindowSize(app, 960, 700);
  await expect(rightPanel()).toBeHidden();
  await expect(sidebar()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  await setWindowSize(app, 1440, 900);
  await expect(rightPanel()).toBeVisible();
});

test('tema escolhido vale para a página e para a janela e persiste após reiniciar', async () => {
  await page.keyboard.press('Control+,');
  const radio = (name: string) => page.getByRole('radio', { name });

  await radio('Escuro').click();
  await expect(radio('Escuro')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(bodyBackground).toBe('rgb(11, 11, 18)');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');

  await radio('Claro').click();
  await expect.poll(bodyBackground).toBe('rgb(247, 247, 251)');

  await app.close();
  ({ app, page } = await launchApp(userData));
  await expect.poll(bodyBackground).toBe('rgb(247, 247, 251)');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
});

test('Configurações mostram o crédito do desenvolvedor com links externos seguros', async () => {
  await page.keyboard.press('Control+,');
  const credits = page.getByTestId('app-credits');
  await expect(credits).toContainText('Desenvolvido por: Felipe Ferreira');
  const site = credits.getByRole('link', { name: 'felipeferreira.dev' });
  await expect(site).toHaveAttribute('href', 'https://felipeferreira.dev');
  await expect(site).toHaveAttribute('target', '_blank');
  await expect(site).toHaveAttribute('rel', /noopener/);
  await expect(credits.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/Felipe-1507');
  await page.keyboard.press('Escape');
});
