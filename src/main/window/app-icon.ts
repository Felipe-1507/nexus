import path from 'node:path';
import { app } from 'electron';
import { BRAND } from '@shared/brand';

/**
 * Ícone do app para a janela, a abertura e a barra de notificação: o do pacote instalado, ou o do repositório em
 * desenvolvimento. Sem ele, rodando pelo código, o Windows mostra na barra de tarefas o ícone do executável do Electron.
 */
export function appIconPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.png');
  return BRAND.icon ?? path.join(app.getAppPath(), 'build', 'icon.png');
}
