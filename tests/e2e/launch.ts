import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export function tempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-'));
}

/** Pasta de conteúdo usada nos testes, dentro do userData temporário. */
export function contentRoot(userData: string): string {
  return path.join(userData, 'conteudo');
}

export interface LaunchOptions {
  /**
   * `missing` (padrão): simula Claude Code não instalado, para os testes não dependerem da máquina nem dispararem
   * o CLI a cada abertura. `real`: usa a instalação desta máquina (testes opcionais com NEXUS_LIVE_TESTS=1).
   */
  claude?: 'missing' | 'real';
  /** Variáveis extras (ex.: NEXUS_CLAUDE_MODEL=haiku nos testes reais). */
  env?: Record<string, string>;
  /** Simula a primeira execução: o aviso de privacidade ainda não foi confirmado. */
  firstRun?: boolean;
}

/** Abre o app compilado (out/) com dados isolados. Reutilize `userData` para simular um reinício. */
export async function launchApp(userData = tempUserData(), options: LaunchOptions = {}): Promise<Launched> {
  // Aponta a pasta de conteúdo para dentro do userData temporário: os testes nunca tocam na pasta real do usuário.
  const prefs = path.join(userData, 'preferences.json');
  if (!fs.existsSync(prefs)) {
    const privacyAcceptedAt = options.firstRun ? null : new Date().toISOString();
    fs.writeFileSync(
      prefs,
      JSON.stringify({ version: 1, dataRoot: contentRoot(userData), theme: 'system', privacyAcceptedAt }),
    );
  }
  // Terminais abertos pelo VS Code herdam ELECTRON_RUN_AS_NODE, que faria o Electron rodar como Node puro.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE',
    ),
  ) as Record<string, string>;
  if (options.claude !== 'real') env.NEXUS_CLAUDE_CLI = path.join(userData, 'sem-claude', 'claude.exe');
  // Os botões de instalar e entrar só registram no log o que abririam: nenhum teste instala nada nem abre console.
  env.NEXUS_SIMULATE_CONSOLE = '1';
  // A abertura animada atrasaria cada teste em 2 s e seria a primeira janela: só o teste dela a liga.
  env.NEXUS_NO_SPLASH = '1';
  const app = await electron.launch({
    args: ['.'],
    env: { ...env, ...options.env, NEXUS_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  // O Playwright emula `prefers-color-scheme: light` por padrão; o tema real vem do nativeTheme do app.
  await page.emulateMedia({ colorScheme: null });
  await page.getByTestId('chat-view').waitFor();
  return { app, page, userData };
}

export async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height]);
}

export function removeUserData(userData: string): void {
  fs.rmSync(userData, { recursive: true, force: true });
}
