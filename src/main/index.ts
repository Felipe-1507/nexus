import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
} from 'electron';
import { turnNotice } from './core/chat/turn-notice';
import {
  deleteSession,
  forkSession,
  getSessionMessages,
  listSessions,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { reapOrphans, systemReaperDeps } from './agent/orphan-reaper';
import { BRAND, PALETTE } from '@shared/brand';
import { paletteCss, withAppearance } from '@shared/palette';
import { CHAT_EVENT_CHANNEL } from '@shared/chat';
import { CODE_EVENT_CHANNEL } from '@shared/code';
import { KNOWLEDGE_EVENT_CHANNEL } from '@shared/knowledge';
import { NexusError } from '@shared/ipc-result';
import {
  createConsoleOpener,
  installCommand,
  loginCommand,
  updateCommand,
  type OpenConsole,
} from './agent/claude-setup';
import { ClaudeUpdateService } from './agent/update-check';
import { ClaudeStatusService } from './agent/claude-status';
import { detectClaude } from './agent/cli-detector';
import { ModelCatalogService, modelValues, newModels } from './agent/model-catalog';
import { PermissionBroker } from './agent/permission-broker';
import { UsageService, type CreateUsageQuery } from './agent/usage-service';
import { SessionManager } from './agent/session-manager';
import { AttachmentMaintenance } from './core/chat/attachment-maintenance';
import { AttachmentService } from './core/chat/attachment-service';
import { ChatService } from './core/chat/chat-service';
import { CodeWatcher } from './core/code/code-watcher';
import { CodeService } from './core/code/code-service';
import { FileOpener } from './core/code/file-opener';
import { GlobalInstructions } from './core/context/global-instructions';
import { KnowledgeService } from './core/knowledge/knowledge-service';
import { PlanetStyleStore } from './core/knowledge/planet-styles';
import { ProjectService } from './core/projects/project-service';
import { WelcomeService } from './core/welcome/welcome-service';
import { askClaudeOnce, type CreateOneShot } from './agent/ask-once';
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
import { appUpdateHandlers } from './ipc/handlers/app-update';
import { AppUpdateService } from './agent/app-update';
import { contentSearchHandlers } from './ipc/handlers/content-search';
import { extensionsHandlers } from './ipc/handlers/extensions';
import { probeExtensions, type CreateProbeQuery } from './agent/extensions-probe';
import { backupHandlers } from './ipc/handlers/backup';
import { BackupService } from './core/backup/backup-service';
import { welcomeHandlers } from './ipc/handlers/welcome';
import { workspaceHandlers } from './ipc/handlers/workspaces';
import { registerIpc } from './ipc/register';
import { backupDatabase, openDatabase, type Database } from './persistence/db';
import { configureLogger, log } from './platform/logger';
import { resolveAppPaths } from './platform/paths';
import { loadPreferences } from './platform/preferences';
import { PreferencesStore } from './platform/preferences-store';
import { runFile } from './platform/run';
import { startMarker, takePreviousMarker } from './platform/run-marker';
import { createWatcher } from './fs/watcher';
import { createBackgroundMode, type BackgroundMode } from './window/background';
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

// Se o Nexus cair sem avisar, o Chromium deixa o relatório da queda nesta máquina (nada é enviado a lugar nenhum).
crashReporter.start({ uploadToServer: false, compress: true });

// Falhas sem tratamento vão para o log em vez de derrubar o app com a caixa de erro padrão do Electron.
process.on('uncaughtException', (err) => log.error('Erro não tratado no main', err));
process.on('unhandledRejection', (reason) => log.error('Promise rejeitada sem tratamento no main', reason));
process.on('exit', (code) => log.info('Processo principal saindo', { code }));
app.on('render-process-gone', (_event, contents, details) =>
  log.warn('Processo de tela encerrou', { reason: details.reason, exitCode: details.exitCode, url: contents.getURL() }),
);
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') log.warn('Processo auxiliar do Electron encerrou', details);
});

let database: Database | undefined;
let sessions: SessionManager | undefined;
let broker: PermissionBroker | undefined;
let knowledge: KnowledgeService | undefined;
let codeWatcher: CodeWatcher | undefined;
let mainWindow: BrowserWindow | undefined;
let background: BackgroundMode | undefined;
let runMarker: { stop: () => void } | undefined;

function bootstrap(): void {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  // A execução anterior terminou sem passar pelo encerramento normal? Fica no log, com a última hora em que esteve viva.
  const fell = takePreviousMarker(userData);
  if (fell) {
    log.warn('A execução anterior terminou sem fechar direito (queda do Nexus, do Windows ou da placa de vídeo)', {
      iniciouEm: fell.startedAt,
      ultimoSinal: fell.lastAlive,
    });
  }
  runMarker = startMarker(userData);
  const prefsFile = resolveAppPaths(userData, app.getPath('home'), null).preferences;
  const { preferences, warning } = loadPreferences(prefsFile);
  const paths = resolveAppPaths(userData, app.getPath('home'), preferences.dataRoot);
  const prefs = new PreferencesStore(prefsFile, preferences);

  configureLogger(paths.logs, !app.isPackaged);
  log.info(`${BRAND.productName} ${app.getVersion()} iniciando`, { userData: paths.userData });
  if (warning) log.warn(`preferences.json ignorado: ${warning}`);

  database = openDatabase(paths.database);
  const backup = backupDatabase(database.db, path.join(paths.userData, 'backups'));
  if (backup) log.info('Cópia de segurança do banco', { arquivo: path.basename(backup) });
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
  // Nos testes (NEXUS_NO_EXTERNAL), links externos só vão para o log: o navegador de quem roda os testes não abre.
  const openExternal =
    !app.isPackaged && process.env.NEXUS_NO_EXTERNAL === '1'
      ? (url: string) => log.info(`[teste] abriria no navegador: ${url}`)
      : undefined;
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isTrusted, openExternal));
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
  // Processos de uma execução anterior que o Windows não encerrou junto (Nexus finalizado à força).
  void reapOrphans(systemReaperDeps).then((pids) => {
    if (pids.length > 0) log.info('Processos do Claude Code órfãos encerrados', { pids });
  });
  const batcher = createEventBatcher((event) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHAT_EVENT_CHANNEL, event);
    notifyTurnEnd(event);
  });
  // Resposta terminou com o Nexus em segundo plano: aviso do Windows (clicar traz a janela). Sem IA: projeto + 1ª linha.
  function notifyTurnEnd(event: Parameters<typeof turnNotice>[0]): void {
    if (event.type !== 'turn-end' || !Notification.isSupported()) return;
    if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return;
    try {
      const row = db.db
        .prepare(
          'SELECT c.title AS title, p.name AS project FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?',
        )
        .get(event.conversationId) as { title: string; project: string | null } | undefined;
      const notice = turnNotice(event, { projectName: row?.project ?? null, conversationTitle: row?.title ?? '' });
      if (!notice) return;
      const n = new Notification({ title: notice.title, body: notice.body, silent: false });
      n.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      n.show();
    } catch (err) {
      log.warn('Aviso de resposta pronta falhou', { erro: err instanceof Error ? err.message : String(err) });
    }
  }
  broker = new PermissionBroker({ emit: batcher.push });
  const claudeUpdates = new ClaudeUpdateService({ fetch: (url, init) => fetch(url, init) });
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
    open: (file) => shell.openPath(file),
    reveal: (file) => shell.showItemInFolder(file),
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(KNOWLEDGE_EVENT_CHANNEL, event);
    },
  });
  const notes = knowledge;
  const code = new CodeService({
    workspaces,
    projects,
    trash: (target) => shell.trashItem(target),
    reveal: (target) => shell.showItemInFolder(target),
    protectedDirs: [paths.userData],
  });
  // A árvore de arquivos pede para observar só as pastas que mostra abertas; mudanças por fora chegam como evento.
  const codeChanges = new CodeWatcher({
    resolveRoot: (scope) => code.root(scope),
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CODE_EVENT_CHANNEL, event);
    },
  });
  codeWatcher = codeChanges;
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
      rename: (sessionId, dir, title) => renameSession(sessionId, title, { dir }),
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
    onNotice: (message, detail) => log.warn(message, detail),
  });

  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const welcome = new WelcomeService({
    prefs,
    projects: async (workspaceId) =>
      (await projects.list(workspaceId))
        .filter((p) => p.status === 'ok')
        .map(({ id, name, path }) => ({ id, name, path })),
    notes: async (workspaceId) =>
      (await notes.graph(workspaceId)).notes.map((n) => ({ title: n.title, system: n.system, mtimeMs: n.mtimeMs })),
    conversations: (workspaceId) =>
      chat
        .listConversations(workspaceId)
        .map((c) => ({ title: c.title, projectId: c.projectId, updatedAt: c.updatedAt })),
    gitLog: async (dir, sinceIso) => {
      // Só leitura. `safe.directory=*` evita o erro de "dono duvidoso" em pastas de rede; o tempo é curto de propósito.
      const r = await runFile(
        'git',
        [
          '-c',
          'safe.directory=*',
          '-C',
          dir,
          'log',
          `--since=${sinceIso}`,
          '--no-merges',
          '--pretty=format:%s',
          '-n',
          '30',
        ],
        { timeoutMs: 8_000, env: gitEnv },
      );
      return r.ok ? r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '') : [];
    },
    gitUser: async () => {
      const r = await runFile('git', ['config', '--get', 'user.name'], { timeoutMs: 3_000, env: gitEnv });
      return r.ok ? r.stdout.trim() || null : null;
    },
    summarize: async (system, prompt) => {
      const status = await claude.get();
      if (status.cli.state !== 'found' || !status.ready) return null;
      return askClaudeOnce({
        createQuery: ((args: unknown) => query(args as Parameters<typeof query>[0])) as unknown as CreateOneShot,
        env: process.env,
        cliPath: status.cli.path,
        cwd: paths.userData,
        system,
        prompt,
      });
    },
    onWarn: (message, detail) => log.warn(message, detail),
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
        'galaxy:getQuality': () => ({ quality: prefs.get().galaxyQuality }),
        'galaxy:setQuality': (quality) => ({ quality: prefs.update({ galaxyQuality: quality }).galaxyQuality }),
        'galaxy:getLook': () => ({ look: prefs.get().galaxyLook }),
        'galaxy:setLook': (look) => ({ look: prefs.update({ galaxyLook: look }).galaxyLook }),
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
        'claude:updateCheck': async ({ refresh }) => {
          const status = await claude.get();
          return claudeUpdates.check(status.cli.state === 'found' ? status.cli.version : null, refresh);
        },
        'claude:update': async () => {
          const status = await claude.get();
          if (status.cli.state !== 'found') {
            throw new NexusError('VALIDATION', 'Instale o Claude Code antes de atualizar.');
          }
          return openSetupConsole('a atualização do Claude Code', updateCommand(status.cli.path));
        },
        'models:news': async () => {
          const status = await claude.get();
          if (status.cli.state !== 'found' || !status.ready) return [];
          const catalog = await models.get(status.cli.path, false);
          const seen = prefs.get().seenModels;
          // Primeiro uso: tudo o que existe agora conta como já visto, para o aviso não nascer cheio.
          if (seen === null) {
            prefs.update({ seenModels: modelValues(catalog) });
            return [];
          }
          return newModels(catalog, seen);
        },
        'models:markSeen': async () => {
          const status = await claude.get();
          if (status.cli.state === 'found' && status.ready) {
            prefs.update({ seenModels: modelValues(await models.get(status.cli.path, false)) });
          }
          return null;
        },
        'claude:login': async () => {
          const status = await claude.get();
          if (status.cli.state !== 'found') {
            throw new NexusError('VALIDATION', 'Instale o Claude Code antes de entrar com a conta.');
          }
          return openSetupConsole('o login do Claude Code', loginCommand(status.cli.path));
        },
        ...appUpdateHandlers(
          new AppUpdateService({
            source: () => prefs.get().updateSource,
            currentVersion: app.getVersion(),
            downloadDir: path.join(paths.userData, 'updates'),
            fetch: (url, init) => fetch(url, init),
            launch: (file, args) => {
              // Solto do Nexus: continua rodando depois que o app fechar.
              spawn(file, args, { detached: true, stdio: 'ignore' }).unref();
              log.info('Instalador de atualização iniciado', { arquivo: path.basename(file) });
            },
            quit: () => app.quit(),
          }),
          (source) => prefs.update({ updateSource: source }).updateSource,
          () => prefs.get().updateSource,
        ),
        ...contentSearchHandlers({
          notes: (workspaceId) => notes.notesText(workspaceId),
          projects: async (workspaceId, projectId) =>
            (await projects.list(workspaceId))
              .filter((p) => p.status === 'ok' && (!projectId || p.id === projectId))
              .map(({ id, name, path: dir }) => ({ id, name, path: dir })),
        }),
        ...extensionsHandlers({
          home: os.homedir(),
          projects: async (workspaceId) =>
            (await projects.list(workspaceId)).map(({ id, name, path: dir }) => ({ id, name, path: dir })),
          probe: async (workspaceId, projectId) => {
            const status = await claude.get();
            if (status.cli.state !== 'found' || !status.ready) {
              throw new NexusError('VALIDATION', 'O Claude Code não está disponível para verificar os servidores.');
            }
            let cwd = paths.userData;
            let scope = 'Configurações do usuário';
            let settingSources: Array<'user' | 'project' | 'local'> = ['user'];
            if (projectId) {
              // Só carrega o que o projeto traz se o usuário já confiou nessas configurações (ADR 0003).
              const session = await projects.sessionSettings(projectId);
              if (session.project.workspaceId !== workspaceId)
                throw new NexusError('NOT_FOUND', 'Projeto não encontrado.');
              cwd = session.project.path;
              scope = `Projeto ${session.project.name}`;
              settingSources = session.settingSources;
            }
            return probeExtensions({
              createQuery: ((args: unknown) =>
                query(args as Parameters<typeof query>[0])) as unknown as CreateProbeQuery,
              env: process.env,
              cliPath: status.cli.path,
              cwd,
              settingSources,
              scope,
            });
          },
        }),
        ...backupHandlers(
          new BackupService({
            db: db.db,
            userData: paths.userData,
            dataRoot: paths.dataRoot,
            appName: BRAND.productName,
            appVersion: app.getVersion(),
          }),
          async (suggestedName) => {
            // Testes E2E não abrem diálogos: o destino vem da variável. Nunca vale para o app instalado.
            if (!app.isPackaged && process.env.NEXUS_BACKUP_TARGET) return process.env.NEXUS_BACKUP_TARGET;
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            const options = {
              title: 'Salvar backup',
              defaultPath: path.join(app.getPath('documents'), suggestedName),
              filters: [{ name: 'Backup (.zip)', extensions: ['zip'] }],
            };
            const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
            return r.canceled || !r.filePath ? null : r.filePath;
          },
        ),
        // Nunca vale para o app instalado.
        ...welcomeHandlers(welcome, !app.isPackaged && process.env.NEXUS_NO_WELCOME === '1'),
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
          watcher: codeChanges,
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

  // Segundo plano: fechar a janela só a esconde; o ícone da barra de notificação reabre ou fecha de verdade.
  background = createBackgroundMode({
    iconPath: trayIconPath(),
    productName: BRAND.productName,
    runningCount: () => sessions?.runningCount() ?? 0,
    confirm: (options) => dialog.showMessageBox(options),
    quit: () => app.quit(),
    showWindow: showMainWindow,
  });
  // Os testes de ponta a ponta acionam o menu do ícone por aqui (não dá para clicar na bandeja). Nunca vale no app instalado.
  if (!app.isPackaged && process.env.NEXUS_NO_SPLASH === '1') {
    (globalThis as { __nexusBackground?: unknown }).__nexusBackground = {
      requestQuit: () => background?.requestQuit(),
      showWindow: showMainWindow,
    };
  }

  openWindow(splash);
}

/** Traz a janela principal de volta (do segundo plano, minimizada ou atrás de outras). Não mexe na abertura animada. */
function showMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    // A janela se perdeu (a interface caiu de vez): abre outra.
    if (app.isReady() && background) openWindow(null);
    return;
  }
  if (!win.isVisible() && !background?.isHidden()) return; // ainda abrindo
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Ícone do aplicativo para a barra de notificação: o do pacote instalado, ou o do repositório em desenvolvimento. */
function trayIconPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.png');
  return BRAND.icon ?? path.join(app.getAppPath(), 'build', 'icon.png');
}

function openWindow(splash: Splash | null): void {
  const win = createMainWindow({
    preloadPath: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
    url: devServerUrl ?? `${APP_ORIGIN}/index.html`,
    devTools: !app.isPackaged,
    ...(splash ? { reveal: (show: () => void) => splash.finish(show) } : {}),
  });
  mainWindow = win;
  background?.attach(win);
  win.on('session-end', () => log.warn('O Windows está encerrando a sessão (session-end)'));
  watchWindowHealth(win, { log, showMessageBox: (w, options) => dialog.showMessageBox(w, options) });
}

/** Prazo (ms) para o encerramento terminar sozinho; depois disso o app sai à força. */
const FORCE_EXIT_MS = 10_000;
const FORCE_EXIT_AFTER_CLEANUP_MS = 3_000;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir o Nexus de novo (atalho, menu Iniciar) com ele em segundo plano traz a janela de volta.
  app.on('second-instance', () => showMainWindow());

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

  let shutDown = false;
  /** Antes de fechar o banco: pedidos de permissão são negados, respostas em andamento são gravadas como interrompidas e os processos encerrados. Roda uma vez só. */
  const shutdown = () => {
    if (shutDown) return;
    shutDown = true;
    log.info('Encerrando: limpando sessões, observadores e banco');
    broker?.cancelAll();
    sessions?.closeAll();
    knowledge?.close();
    codeWatcher?.close();
    background?.dispose();
    database?.db.close();
    runMarker?.stop();
    log.info('Encerramento limpo');
  };
  app.on('before-quit', () => {
    log.info('Pedido para fechar o Nexus');
    background?.markQuitting();
    // Se uma janela ou processo não responder ao fechamento (tela travada, Claude preso), o app não pode ficar
    // pendurado no Gerenciador de Tarefas: passado o prazo, limpa tudo e sai à força.
    setTimeout(() => {
      log.warn('O encerramento passou de ' + FORCE_EXIT_MS / 1000 + ' s; saindo à força.');
      shutdown();
      app.exit(0);
    }, FORCE_EXIT_MS).unref();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    shutdown();
    // Já limpo: se o Electron ainda demorar para encerrar os processos de tela, sai logo.
    setTimeout(() => app.exit(0), FORCE_EXIT_AFTER_CLEANUP_MS).unref();
  });
}
