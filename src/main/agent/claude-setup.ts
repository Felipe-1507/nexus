import { spawn } from 'node:child_process';
import { BRAND } from '@shared/brand';
import { childEnv } from './child-env';

/** Programa aberto numa janela de console própria, visível para o usuário. Argumentos sem espaços. */
export interface ConsoleCommand {
  file: string;
  args: string[];
}

/** Instalador oficial do Claude Code para Windows. Não precisa de Node.js nem de administrador. */
export const INSTALL_URL = 'https://claude.ai/install.ps1';

export function installCommand(): ConsoleCommand {
  const script = [
    "Write-Host 'Instalando o Claude Code (instalador oficial da Anthropic)...'",
    `irm ${INSTALL_URL} | iex`,
    "Write-Host ''",
    `Read-Host 'Pronto. Pressione Enter para fechar esta janela e voltar ao ${BRAND.productName.replace(/'/g, "''")}'`,
  ].join('; ');
  // -EncodedCommand (UTF-16LE em base64): o script chega inteiro, sem depender de aspas na linha de comando.
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  };
}

/** Login do próprio Claude Code: abre o navegador. O Nexus não vê nem guarda nada da autenticação. */
export function loginCommand(cliPath: string): ConsoleCommand {
  return { file: cliPath, args: ['auth', 'login'] };
}

export type OpenConsole = (command: ConsoleCommand) => Promise<void>;

/**
 * Lançador oculto que pede ao Windows uma janela de console nova (`Start-Process`). O `detached` do Node não serve:
 * no Windows ele cria o processo sem console algum, e o PowerShell termina sem rodar nada. O programa e os
 * argumentos chegam por variáveis de ambiente, então nenhum caractere do caminho vira código.
 */
export const LAUNCHER = 'Start-Process -FilePath $env:NEXUS_CONSOLE_FILE -ArgumentList $env:NEXUS_CONSOLE_ARGS';

/** Abre o comando numa janela de console nova, com o ambiente de `childEnv()`. A janela não depende do Nexus. */
export function createConsoleOpener(env: NodeJS.ProcessEnv, spawnFn: typeof spawn = spawn): OpenConsole {
  return ({ file, args }) =>
    new Promise((resolve, reject) => {
      if (args.length === 0 || args.some((a) => a === '' || /\s/.test(a))) {
        return reject(new Error('Argumentos inválidos para o console.'));
      }
      const child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LAUNCHER], {
        env: { ...childEnv(env), NEXUS_CONSOLE_FILE: file, NEXUS_CONSOLE_ARGS: args.join(' ') },
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`o Windows não abriu a janela (código ${code ?? '?'})`)),
      );
    });
}

/** Atualização do próprio Claude Code (`claude update`) numa janela de console, como o login. */
export function updateCommand(cliPath: string): ConsoleCommand {
  return { file: cliPath, args: ['update'] };
}
