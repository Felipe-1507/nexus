import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { contentRoot, launchApp, removeUserData } from './launch';

// Workspaces (Etapa 3): criar, alternar, instruções, editar e arquivar com efeito real no disco.
let app: ElectronApplication;
let page: Page;
let userData: string;

const list = () => page.getByRole('list', { name: 'Lista de Workspaces' });
const workspaceDirs = () => fs.readdirSync(path.join(contentRoot(userData), 'workspaces'));
const dirOf = (prefix: string) => {
  const dir = workspaceDirs().find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`pasta ${prefix}* não encontrada`);
  return path.join(contentRoot(userData), 'workspaces', dir);
};

async function createWorkspace(name: string, opts: { color?: string; icon?: string } = {}) {
  await page.getByRole('button', { name: 'Novo Workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo Workspace' });
  await dialog.getByRole('textbox', { name: 'Nome do Workspace' }).fill(name);
  if (opts.color) await dialog.getByRole('radio', { name: opts.color }).click();
  if (opts.icon) await dialog.getByRole('radio', { name: opts.icon }).click();
  await dialog.getByRole('button', { name: 'Criar Workspace' }).click();
  return dialog;
}

test.beforeAll(async () => {
  ({ app, page, userData } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
  removeUserData(userData);
});

test('começa vazio e oferece criar o primeiro Workspace', async () => {
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Nenhum Workspace ainda');
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Nenhum Workspace');
});

test('valida o nome antes de criar', async () => {
  const dialog = await createWorkspace('   ');
  await expect(dialog.getByRole('alert')).toHaveText('Dê um nome ao Workspace');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
});

test('cria o Workspace com a pasta real no disco e o torna ativo', async () => {
  const dialog = await createWorkspace('Trabalho', { color: 'Azul', icon: 'Finanças' });
  await expect(dialog).toBeHidden();

  await expect(list()).toContainText('Trabalho');
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Trabalho');
  await expect(page.getByTestId('chat-view').getByRole('heading', { level: 1 })).toHaveText('Trabalho');

  const root = dirOf('trabalho-');
  for (const entry of ['workspace.md', 'Conhecimentos', 'Projetos', path.join('.nexus', 'workspace.json')]) {
    expect(fs.existsSync(path.join(root, entry)), entry).toBe(true);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(root, '.nexus', 'workspace.json'), 'utf8'));
  expect(meta).toMatchObject({ name: 'Trabalho', color: 'blue', icon: 'wallet' });
});

test('recusa nome repetido', async () => {
  const dialog = await createWorkspace('TRABALHO');
  await expect(dialog.getByRole('alert')).toContainText('Já existe um Workspace');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  expect(workspaceDirs()).toHaveLength(1);
});

test('alterna entre Workspaces e lembra o ativo após reiniciar', async () => {
  await createWorkspace('Pessoal', { icon: 'Casa' });
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Pessoal');

  await list().getByRole('button', { name: 'Trabalho', exact: true }).click();
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Trabalho');

  await app.close();
  ({ app, page } = await launchApp(userData));
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Trabalho');
  await expect(list().getByRole('listitem')).toHaveCount(2);
});

test('edita as instruções e grava no workspace.md', async () => {
  await page.getByRole('button', { name: 'Abrir Trabalho: instruções e detalhes' }).click();
  const editor = page.getByRole('textbox', { name: 'Instruções do Workspace' });
  await expect(editor).toHaveValue('# Instruções: Trabalho\n\n');

  await editor.fill('# Trabalho\n\n- Valores sempre em BRL\n- Datas no formato dd/mm/aaaa\n');
  await expect(page.getByTestId('instructions-status')).toHaveText('Salvo');
  expect(fs.readFileSync(path.join(dirOf('trabalho-'), 'workspace.md'), 'utf8')).toBe(
    '# Trabalho\n\n- Valores sempre em BRL\n- Datas no formato dd/mm/aaaa\n',
  );
});

test('não sobrescreve alteração feita fora do Nexus', async () => {
  const file = path.join(dirOf('trabalho-'), 'workspace.md');
  fs.writeFileSync(file, '# Editado no Obsidian\n');
  const future = new Date(Date.now() + 10_000);
  fs.utimesSync(file, future, future);

  const editor = page.getByRole('textbox', { name: 'Instruções do Workspace' });
  await editor.fill('# Versão do Nexus\n');
  await expect(page.getByRole('alert')).toContainText('alterado fora do Nexus');
  expect(fs.readFileSync(file, 'utf8')).toBe('# Editado no Obsidian\n');

  await page.getByRole('button', { name: 'Usar a versão do disco' }).click();
  await expect(editor).toHaveValue('# Editado no Obsidian\n');
  await expect(page.getByTestId('instructions-status')).toHaveText('Salvo');
});

test('edita nome e aparência sem mudar a pasta', async () => {
  const root = dirOf('trabalho-');
  await page.getByRole('button', { name: 'Editar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar Workspace' });
  await dialog.getByRole('textbox', { name: 'Nome do Workspace' }).fill('Meu Trabalho');
  await dialog.getByRole('radio', { name: 'Verde' }).click();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId('workspace-view').getByRole('heading', { level: 1 })).toHaveText('Meu Trabalho');
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Meu Trabalho');
  expect(fs.existsSync(root)).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(root, '.nexus', 'workspace.json'), 'utf8')).name).toBe(
    'Meu Trabalho',
  );
});

test('arquivar tira da lista e mantém os arquivos', async () => {
  const root = dirOf('trabalho-');
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Arquivar "Meu Trabalho"/ });
  await dialog.getByRole('button', { name: 'Arquivar' }).click();

  await expect(page.getByTestId('chat-view')).toBeVisible();
  await expect(list().getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Pessoal');
  expect(fs.existsSync(path.join(root, 'workspace.md'))).toBe(true);
});
