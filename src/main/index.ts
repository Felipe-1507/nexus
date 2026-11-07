import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, session, shell } from 'electron';
import { deleteSession, forkSession, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { BRAND, PALETTE } from '@shared/brand';
import { paletteCss, withAppearance } from '@shared/palette';
import { CHAT_EVENT_CHANNEL } from '@shared/chat';
import { KNOWLEDGE_EVENT_CHANNEL } from '@shared/knowledge';
import { NexusError } from '@shared/ipc-result';
import { createConsoleOpener, installCommand, loginCommand, type OpenConsole } from './agent/claude-setup';
import { ClaudeStatusService } from './agent/claude-status';
import { detectClaude } from './agent/cli-detector';
import { ModelCatalogService } from './agent/model-catalog';
import { PermissionBroker } from './agent/permission-broker';
import { UsageService, type CreateUsageQuery } from './agent/usage-service';
import { SessionManager } from './agent/session-manager';
import { AttachmentMaintenance } from './core/chat/attachment-maintenance';
import { AttachmentService } from './core/chat/attachment-service';
import { ChatService } from './core/chat/chat-service';
import { CodeService } from './core/code/code-service';
import { FileOpener } from './core/code/file-opener';
import { GlobalInstructions } from './core/context/global-instructions';
import { KnowledgeService } from './core/knowledge/knowledge-service';
import { PlanetStyleStore } from './core/knowledge/planet-styles';
import { ProjectService } from './core/projects/project-service';
import { PermissionsService } from './core/permissions/permissions-service';
import { WorkspaceService } from './core/workspaces/workspace-service';
import { createEventBatcher } from './ipc/event-batcher';
import { createDispatcher } from './ipc/dispatcher';
import { getAppInfo, openKnownPath } from './ipc/handlers/app';
import { chatHandlers } from './ipc/handlers/chat';
import { codeHandlers } from './ipc/handlers/code';
import { contextHandlers } from './ipc/handlers/context';
import { knowledgeHandlers } from './ipc/handlers/knowledge';
import { permissionHandlers } from './ipc/handlers/permissions';
import { projectHandlers } from './ipc/handlers/projects';
import { workspaceHandlers } from './ipc/handlers/workspaces';
import { registerIpc } from './ipc/register';
import { openDatabase, type Database } from './persistence/db';
import { configureLogger, log } from './platform/logger';
import { resolveAppPaths } from './platform/paths';
import { loadPreferences } from './platform/preferences';
import { PreferencesStore } from './platform/preferences-store';
import { runFile } from './platform/run';
import { createWatcher } from './fs/watcher';
import { createMainWindow } from './window/main-window';
import { introVideoPage, openSplash, type Splash } from './window/splash';
import { createOriginGuard } from './window/origin';
import { watchWindowHealth } from './window/recovery';
import { APP_ORIGIN, handleAppProtocol, registerAppScheme } from './window/protocol';
import { applySessionSecurity, hardenWebContents } from './window/security';
import { activePalette, applyPalette, applyTheme, syncWindowsWithTheme } from './window/theme';

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;

// Nome e pastas vêm da marca (padrão "Nexus"), também em desenvolvimento: duas marcas no mesmo computador não
// misturam dados. Exceções: os testes E2E isolam os dados numa pasta temporária (nunca vale para o app instalado), e
// quem abre o app com `--user-data-dir` (o teste do pacote, por exemplo) escolheu a pasta e ela é respeitada.
app.setName(BRAND.productName);
app.setAppUserModelId(BRAND.appId);
if (!app.isPackaged && process.env.NEXUS_USER_DATA_DIR) {
  app.setPath('userData', process.env.NEXUS_USER_DATA_DIR);
} else if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), BRAND.productName));
}

registerAppScheme();

// Falhas sem tratamento vão para o log em vez de derrubar o app com a caixa de erro padrão do Electron.
process.on('uncaughtException', (err) => log.error('Erro não tratado no main', err));
process.on('unhandledRejection', (reason) => log.error('Promise rejeitada sem tratamento no main', reason));
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') log.warn('Processo auxiliar do Electron encerrou', details);
});

let database: Database | undefined;
let sessions: SessionManager | undefined;
let broker: PermissionBroker | undefined;
let knowledge: KnowledgeService | undefined;
let mainWindow: BrowserWindow | undefined;

function bootstrap(): void {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const prefsFile = resolveAppPaths(userData, app.getPath('home'), null).preferences;
  const { preferences, warning } = loadPreferences(prefsFile);
  const paths = resolveAppPaths(userData, app.getPath('home'), preferences.dataRoot);
  const prefs = new PreferencesStore(prefsFile, preferences);

  configureLogger(paths.logs, !app.isPackaged);
  log.info(`${BRAND.productName} ${app.getVersion()} iniciando`, { userData: paths.userData });
  if (warning) log.warn(`preferences.json ignorado: ${warning}`);

  database = openDatabase(paths.database);
  log.info('Banco pronto', { versao: database.migration.current, aplicadas: database.migration.applied });

  applyTheme(preferences.theme);
  applyPalette(withAppearance(PALETTE, preferences));
  syncWindowsWithTheme();
  prefs.onChange((next, previous) => {
    if (next.theme !== previous.theme) applyTheme(next.theme);
    if (next.darkVariant !== previous.darkVariant || next.accent !== previous.accent) {
      applyPalette(withAppearance(PALETTE, next));
    }
  });

  const isTrusted = createOriginGuard([devServerOrigin ?? APP_ORIGIN]);
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isTrusted));
  applySessionSecurity(session.defaultSession, devServerOrigin);
  if (!devServerUrl) {
    handleAppProtocol(fileURLToPath(new URL('../renderer', import.meta.url)), {
      headStyle: () => paletteCss(activePalette()),
    });
  }
  if (app.isPackaged) Menu.setApplicationMenu(null);

  // Abertura animada, já com a cor de destaque do usuário. Os testes de ponta a ponta a desligam (nunca vale no app
  // instalado).
  const splash: Splash | null =
    !app.isPackaged && process.env.NEXUS_NO_SPLASH === '1'
      ? null
      : openSplash({
          accent: activePalette().dark.accent,
          name: BRAND.productName,
          icon: BRAND.icon,
          // O vídeo traz o nome "Nexus" desenhado: só vale para a marca padrão.
          video: introVideoPage(BRAND.productName === 'Nexus'),
        });

  const db = database;
  const workspaces = new WorkspaceService({ db: db.db, dataRoot: paths.dataRoot });
  const shellOpen = (p: string) => shell.openPath(p);
  const claude = new ClaudeStatusService(() =>
    detectClaude({
      platform: process.platform,
      env: process.env,
      homedir: os.homedir(),
      run: runFile,
      exists: (f) => fs.existsSync(f),
      readText: (f) => fs.readFileSync(f, 'utf8'),
      // Testes E2E simulam "não instalado" apontando para um caminho inexistente. Nunca vale para o app instalado.
      overridePath: app.isPackaged ? undefined : process.env.NEXUS_CLAUDE_CLI,
    }),
  );
  // Testes E2E não abrem janelas de console de verdade (nem instalam nada). Nunca vale para o app instalado.
  const openConsole: OpenConsole =
    !app.isPackaged && process.env.NEXUS_SIMULATE_CONSOLE === '1'
      ? async (command) => void log.info('Console simulado', command)
      : createConsoleOpener(process.env);
  const openSetupConsole = async (what: string, command: Parameters<OpenConsole>[0]) => {
    try {
      await openConsole(command);
    } catch (err) {
      log.error(`Falha ao abrir ${what}`, err);
      throw new NexusError('INTERNAL', `Não foi possível abrir ${what}: ${(err as Error).message}`);
    }
    return null;
  };
  // Começa a verificação junto com o app; a tela recebe o resultado quando pedir.
  claude
    .get()
    .then((s) => log.info('Claude Code', { cli: s.cli, auth: s.auth.state, avisos: s.warnings.length }))
    .catch((err: unknown) => log.error('Falha ao verificar o Claude Code', err));

  sessions = new SessionManager({
    createQuery: (args) => query(args),
    env: process.env,
    onStderr: (conversationId, data) => log.debug(`claude[${conversationId.slice(0, 8)}] ${data.trim()}`),
  });
  const batcher = createEventBatcher((event) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHAT_EVENT_CHANNEL, event);
  });
  broker = new PermissionBroker({ emit: batcher.push });
  const models = new ModelCatalogService({ createQuery: (args) => query(args), env: process.env, cwd: paths.userData });
  const permissions = new PermissionsService(db.db, broker);
  const usage = new UsageService({
    createQuery: ((args: unknown) => query(args as Parameters<typeof query>[0])) as unknown as CreateUsageQuery,
    env: process.env,
    cwd: paths.userData,
  });
  const projects = new ProjectService({ db: db.db, workspaces });
  const global = new GlobalInstructions(db.db);
  knowledge = new KnowledgeService({
    workspaces,
    watch: createWatcher(),
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(KNOWLEDGE_EVENT_CHANNEL, event);
    },
  });
  const notes = knowledge;
  const code = new CodeService({
    workspaces,
    projects,
    trash: (target) => shell.trashItem(target),
    protectedDirs: [paths.userData],
  });
  const attachments = new AttachmentService({
    workspaces,
    thumbnail: (file) => {
      const image = nativeImage.createFromPath(file);
      return image.isEmpty() ? null : image.resize({ height: 160 }).toDataURL();
    },
  });
  const chat = new ChatService({
    db: db.db,
    // Cópia local do arquivo da sessão (sem processo e sem API); só a cópia é apagada se algo falhar.
    forker: {
      fork: async (sessionId, dir, title) => (await forkSession(sessionId, { dir, title })).sessionId,
      remove: (sessionId, dir) => deleteSession(sessionId, { dir }),
    },
    attachments,
    workspaces,
    projects,
    knowledge: notes,
    globalInstructions: () => global.get(),
    // includeWorktrees: false evita o git na pasta (em pasta de rede levou 126 s; Etapa 7, achado K).
    transcripts: {
      list: (dir) => listSessions({ dir, includeWorktrees: false }),
      messages: (sessionId, dir) => getSessionMessages(sessionId, { dir }),
    },
    permissions,
    sessions,
    getClaude: () => claude.get(),
    emit: batcher.push,
    // Testes reais usam um modelo barato (ex.: haiku). Nunca vale para o app instalado.
    model: app.isPackaged ? undefined : process.env.NEXUS_CLAUDE_MODEL || undefined,
    onError: (message, err) => log.error(message, err),
  });

  const attachmentMaintenance = new AttachmentMaintenance({ workspaces, attachments, chat });
  // Depois da partida, sem atrasar a janela: apaga o que nunca foi enviado e já tem alguns dias.
  setTimeout(() => {
    try {
      const r = attachmentMaintenance.pruneOrphans();
      if (r.removed > 0) log.info('Anexos antigos removidos', r);
    } catch (err) {
      log.warn('Falha na limpeza de anexos', err);
    }
  }, 30_000).unref();

  registerIpc(
    createDispatcher(
      {
        'app:getInfo': () =>
          getAppInfo({
            appVersion: app.getVersion(),
            paths,
            schemaVersion: db.migration.current,
            sqliteVersion: db.sqliteVersion,
          }),
        'app:openPath': (key) => openKnownPath(key, paths, shellOpen),
        'preferences:get': () => ({ theme: prefs.get().theme }),
        'preferences:setTheme': (theme) => ({ theme: prefs.update({ theme }).theme }),
        'appearance:get': () => ({ darkVariant: prefs.get().darkVariant, accent: prefs.get().accent }),
        'appearance:set': (patch) => {
          const next = prefs.update(patch);
          return { darkVariant: next.darkVariant, accent: next.accent };
        },
        'privacy:get': () => ({ acceptedAt: prefs.get().privacyAcceptedAt }),
        'privacy:accept': () => {
          const acceptedAt = prefs.get().privacyAcceptedAt ?? new Date().toISOString();
          return { acceptedAt: prefs.update({ privacyAcceptedAt: acceptedAt }).privacyAcceptedAt };
        },
        'app:reportError': ({ source, message, stack }) => {
          log.error(`Erro na interface (${source}): ${message}`, stack ?? '');
          return null;
        },
        ...workspaceHandlers(workspaces, shellOpen),
        'claude:status': ({ refresh }) => claude.get(refresh),
        'claude:install': () => openSetupConsole('o instalador do Claude Code', installCommand()),
        'claude:login': async () => {
          const status = await claude.get();
          if (status.cli.state !== 'found') {
            throw new NexusError('VALIDATION', 'Instale o Claude Code antes de entrar com a conta.');
          }
          return openSetupConsole('o login do Claude Code', loginCommand(status.cli.path));
        },
        ...chatHandlers(chat, attachments, attachmentMaintenance),
        ...contextHandlers(chat),
        ...permissionHandlers({ chat, permissions, workspaces, reveal: (p) => shell.showItemInFolder(p) }),
        'clipboard:write': ({ text }) => {
          clipboard.writeText(text);
          return null;
        },
        'usage:get': async ({ refresh }) => {
          const status = await claude.get();
          if (status.cli.state !== 'found' || !status.ready) {
            throw new NexusError('VALIDATION', 'O Claude Code não está disponível para ler o uso.');
          }
          return usage.get(status.cli.path, refresh);
        },
        'models:list': async ({ refresh }) => {
          const status = await claude.get();
          if (status.cli.state !== 'found' || !status.ready) {
            throw new NexusError('VALIDATION', 'O Claude Code não está disponível para listar os modelos.');
          }
          return models.get(status.cli.path, refresh);
        },
        'workspaces:setDefaultModel': ({ id, model, effort }) => workspaces.setDefaultModel(id, { model, effort }),
        ...knowledgeHandlers(notes, new PlanetStyleStore((id) => notes.dir(id))),
        ...codeHandlers({
          code,
          files: new FileOpener({
            workspaces,
            code,
            reveal: (file) => shell.showItemInFolder(file),
            openFolder: (dir) => shell.openPath(dir),
          }),
          chat,
          // Só endereços vscode:// montados pelo CodeService (caminho já conferido dentro do escopo).
          openUrl: (url) => shell.openExternal(url),
        }),
        ...projectHandlers({
          projects,
          chat,
          global,
          pickFolder: async () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            const options = { title: 'Escolher pasta do projeto', properties: ['openDirectory' as const] };
            const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
          },
        }),
      },
      { isTrustedSender: isTrusted, onError: (channel, err) => log.error(`IPC ${channel} falhou`, err) },
    ),
  );

  openWindow(splash);
}

function openWindow(splash: Splash | null): void {
  const win = createMainWindow({
    preloadPath: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
    url: devServerUrl ?? `${APP_ORIGIN}/index.html`,
    devTools: !app.isPackaged,
    ...(splash ? { reveal: (show: () => void) => splash.finish(show) } : {}),
  });
  mainWindow = win;
  watchWindowHealth(win, { log, showMessageBox: (w, options) => dialog.showMessageBox(w, options) });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // A janela principal (não a abertura, que pode ainda estar na tela).
    const win = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((err: unknown) => {
      log.error('Falha ao iniciar', err);
      dialog.showErrorBox(
        `${BRAND.productName} não conseguiu iniciar`,
        err instanceof Error ? err.message : String(err),
      );
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    // Antes de fechar o banco: pedidos de permissão são negados, respostas em andamento são gravadas como
    // interrompidas e os processos encerrados.
    broker?.cancelAll();
    sessions?.closeAll();
    knowledge?.close();
    database?.db.close();
  });
}
