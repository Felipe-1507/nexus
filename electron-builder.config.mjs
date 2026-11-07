// Instalador do app (Windows, NSIS). Gerar com `npm run dist`; o resultado fica em release/.
// Nome, identificador, autor e ícone vêm da marca (scripts/branding.mjs): "Nexus" por padrão, ou a de branding.local/.
import { artifactBase, DEFAULT_ICON, loadBranding } from './scripts/branding.mjs';

const branding = loadBranding();

/** @type {import('electron-builder').Configuration} */
export default {
  appId: branding.appId,
  productName: branding.productName,
  // O package.json do pacote recebe a mesma marca (o Electron tira dele o nome do app). O autor vira a "organização" do
  // executável e o editor no "Adicionar ou remover programas"; precisa ser objeto, porque texto simples é ignorado e
  // sobra o "GitHub, Inc." do Electron. Sem autor na marca, vale o próprio nome do app.
  extraMetadata: {
    productName: branding.productName,
    author: { name: branding.author ?? branding.productName },
  },
  directories: { output: 'release', buildResources: 'build' },

  // Só o código compilado. As dependências de produção (as que o main carrega) entram sozinhas.
  files: [
    'out/**/*',
    'package.json',
    // O SDK traz uma cópia própria do Claude Code (~290 MB) para cada plataforma. O Nexus usa sempre o Claude Code
    // instalado no computador (pathToClaudeCodeExecutable), então essas cópias ficam de fora.
    '!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**',
  ],
  // Vídeo da abertura: fora do ASAR, para a janela de abertura carregá-lo por caminho de arquivo.
  extraResources: [{ from: 'build/intro', to: 'intro' }],
  asar: true,
  // Traduções do Chromium (menus de contexto, diálogos nativos): só as que o app usa.
  electronLanguages: ['pt-BR', 'en-US'],

  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
    grantFileProtocolExtraPrivileges: false,
  },

  win: {
    target: [{ target: 'nsis', arch: 'x64' }],
    // PNG quadrado (≥ 256): o electron-builder gera o .ico do executável e do instalador.
    icon: branding.icon ?? DEFAULT_ICON,
    artifactName: `${artifactBase(branding)}-\${version}-instalador.\${ext}`,
  },

  nsis: {
    // Instala só para o usuário atual, sem pedir administrador.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: branding.productName,
    // Desinstalar não apaga conversas, notas nem configurações.
    deleteAppDataOnUninstall: false,
    installerLanguages: ['pt_BR'],
    language: '1046',
  },
};
