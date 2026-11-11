import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentSchema,
  ATTACHMENT_MIMES,
  chatMessageSchema,
  conversationSchema,
  enqueueMessageSchema,
  queuedMessageSchema,
  sendMessageResultSchema,
  sendMessageSchema,
} from './chat';
import { claudeStatusSchema, claudeUpdateSchema } from './claude';
import {
  continuationPreviewSchema,
  contextOverviewSchema,
  contextStateSchema,
  contextThresholdsSchema,
  continueInputSchema,
  continueResultSchema,
} from './context';
import { codeEntrySchema, codeFileSchema, codeScopeSchema, fileChangeSchema } from './code';
import {
  galaxyGraphSchema,
  noteLinksSchema,
  notePathSchema,
  noteSchema,
  noteTreeNodeSchema,
  planetStylesSchema,
} from './knowledge';
import { planetOverrideSchema } from './planets';
import { usageSchema } from './usage';
import { modelCatalogSchema, modelChoiceSchema, modelOptionSchema } from './models';
import { DARK_VARIANT_IDS } from './palette';
import { claudeSessionSummarySchema, createProjectSchema, folderInspectionSchema, projectSchema } from './project';
import type { IpcChannel } from './ipc-channels';
import {
  auditEntrySchema,
  permissionDecisionSchema,
  permissionModeSchema,
  questionAnswersSchema,
  permissionRequestSchema,
  permissionRuleSchema,
} from './permissions';
import {
  createWorkspaceSchema,
  instructionsSchema,
  saveInstructionsSchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from './workspace';

const byId = z.object({ id: z.uuid() });

export const workspaceListSchema = z.object({ workspaces: z.array(workspaceSchema), activeId: z.string().nullable() });
export type WorkspaceList = z.infer<typeof workspaceListSchema>;

export const appInfoSchema = z.object({
  appVersion: z.string(),
  versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }),
  platform: z.string(),
  paths: z.object({
    userData: z.string(),
    dataRoot: z.string(),
    database: z.string(),
    logs: z.string(),
  }),
  database: z.object({ schemaVersion: z.number().int(), sqliteVersion: z.string() }),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const saveAttachmentSchema = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  mime: z.enum(ATTACHMENT_MIMES),
  /** Conteúdo em base64 (sem o prefixo data:). */
  data: z.string().max(Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 16),
});

export const attachmentUsageSchema = z.object({ count: z.number().int(), bytes: z.number().int() });

export const themeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;

export const preferencesViewSchema = z.object({ theme: themeSchema });

/** Variação do tema escuro e cor de destaque escolhidas pelo usuário (src/shared/palette.ts). */
export const appearanceSchema = z.object({
  darkVariant: z.enum(DARK_VARIANT_IDS),
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Use uma cor no formato #rrggbb')
    .nullable(),
});
export type PreferencesView = z.infer<typeof preferencesViewSchema>;

/** Modo de visualização da galáxia: Leve (dia a dia, econômico) ou Original (a experiência completa, de referência). */
export const galaxyQualitySchema = z.enum(['leve', 'original']);
export type GalaxyQuality = z.infer<typeof galaxyQualitySchema>;

/** Pastas que o renderer pode pedir para abrir no Explorer. Nunca um caminho arbitrário. */
export const openablePathSchema = z.enum(['userData', 'logs']);
export type OpenablePath = z.infer<typeof openablePathSchema>;

/** Aviso de privacidade: `acceptedAt` fica nulo até o usuário confirmar a leitura (na primeira execução). */
export const privacySchema = z.object({ acceptedAt: z.string().nullable() });
export type Privacy = z.infer<typeof privacySchema>;

/** Erro da interface enviado para o log do main (o renderer não grava arquivos). */
export const rendererErrorSchema = z.object({
  source: z.enum(['render', 'window', 'promise']),
  message: z.string().max(2_000),
  stack: z.string().max(10_000).optional(),
});
export type RendererError = z.infer<typeof rendererErrorSchema>;

/**
 * Contrato único entre renderer e main: cada canal declara a entrada e a saída.
 * O main valida as duas. O renderer obtém os tipos daqui.
 */
export const ipcContract = {
  'app:getInfo': { input: z.undefined(), output: appInfoSchema },
  'app:openPath': { input: openablePathSchema, output: z.null() },
  'app:reportError': { input: rendererErrorSchema, output: z.null() },
  'privacy:get': { input: z.undefined(), output: privacySchema },
  'privacy:accept': { input: z.undefined(), output: privacySchema },
  'preferences:get': { input: z.undefined(), output: preferencesViewSchema },
  'preferences:setTheme': { input: themeSchema, output: preferencesViewSchema },
  'galaxy:getQuality': { input: z.undefined(), output: z.object({ quality: galaxyQualitySchema }) },
  'galaxy:setQuality': { input: galaxyQualitySchema, output: z.object({ quality: galaxyQualitySchema }) },
  'appearance:get': { input: z.undefined(), output: appearanceSchema },
  'appearance:set': { input: appearanceSchema.partial(), output: appearanceSchema },
  'workspaces:list': { input: z.undefined(), output: workspaceListSchema },
  'workspaces:create': { input: createWorkspaceSchema, output: workspaceSchema },
  'workspaces:update': { input: updateWorkspaceSchema, output: workspaceSchema },
  'workspaces:archive': { input: byId, output: z.null() },
  'workspaces:setActive': { input: byId, output: z.null() },
  'workspaces:openFolder': { input: byId, output: z.null() },
  'workspaces:readInstructions': { input: byId, output: instructionsSchema },
  'workspaces:saveInstructions': { input: saveInstructionsSchema, output: z.object({ mtimeMs: z.number() }) },
  'claude:status': { input: z.object({ refresh: z.boolean() }), output: claudeStatusSchema },
  /** Copia texto para a área de transferência do sistema (feito no main: não depende de a janela estar em foco). */
  'clipboard:write': { input: z.object({ text: z.string().max(2_000_000) }), output: z.null() },
  /** Uso do plano (janela de 5 horas, semana). Lido do Claude Code sem gastar tokens; `refresh` ignora o cache. */
  'usage:get': { input: z.object({ refresh: z.boolean() }), output: usageSchema },
  /** Abre o instalador oficial do Claude Code numa janela do PowerShell. */
  'claude:install': { input: z.undefined(), output: z.null() },
  /** Compara a versão instalada do Claude Code com a mais nova (internet, no máximo a cada 6 horas; `refresh` força). */
  'claude:updateCheck': { input: z.object({ refresh: z.boolean() }), output: claudeUpdateSchema },
  /** Abre `claude update` num console para instalar a versão mais nova. */
  'claude:update': { input: z.undefined(), output: z.null() },
  /** Modelos que apareceram depois da última vez que o usuário viu a lista. */
  'models:news': { input: z.undefined(), output: z.array(modelOptionSchema) },
  /** Marca todos os modelos atuais como vistos (some o aviso). */
  'models:markSeen': { input: z.undefined(), output: z.null() },
  /** Abre o login do próprio Claude Code (`claude auth login`) num console. */
  'claude:login': { input: z.undefined(), output: z.null() },
  'conversations:list': {
    // projectId: null = conversas gerais do Workspace; um id = conversas do projeto.
    input: z.object({ workspaceId: z.uuid(), projectId: z.uuid().nullable().optional() }),
    output: z.array(conversationSchema),
  },
  'conversations:messages': { input: z.object({ conversationId: z.uuid() }), output: z.array(chatMessageSchema) },
  /** Troca o nome da conversa (no Nexus e na sessão do Claude Code). */
  'conversations:rename': {
    input: z.object({ conversationId: z.uuid(), title: z.string().max(200) }),
    output: conversationSchema,
  },
  'conversations:archive': { input: z.object({ conversationId: z.uuid() }), output: z.null() },
  /** Traz para a tela as mensagens que a sessão do Claude Code ganhou fora do Nexus. Não altera a sessão. */
  'conversations:sync': {
    input: z.object({ conversationId: z.uuid() }),
    output: z.object({ added: z.number().int() }),
  },
  'chat:send': { input: sendMessageSchema, output: sendMessageResultSchema },
  'chat:interrupt': { input: z.object({ conversationId: z.uuid() }), output: z.null() },
  /** Guarda um arquivo colado ou arrastado no chat (dados em base64). O arquivo só vai ao Claude quando a mensagem é enviada. */
  'attachments:save': { input: saveAttachmentSchema, output: attachmentSchema },
  /** Miniatura (data URL) de uma imagem anexada; `null` para PDF ou arquivo que sumiu. */
  'attachments:thumb': {
    input: z.object({ workspaceId: z.uuid(), attachment: attachmentSchema }),
    output: z.object({ dataUrl: z.string().nullable() }),
  },
  /** Quantos anexos há guardados (em todos os Workspaces) e quanto espaço ocupam. */
  'attachments:usage': { input: z.undefined(), output: attachmentUsageSchema },
  /** Apaga anexos com mais de `olderThanDays` dias, inclusive os de mensagens (que ficam sem a miniatura). */
  'attachments:cleanup': {
    input: z.object({ olderThanDays: z.number().int().min(1).max(3650) }),
    output: z.object({ removed: z.number().int(), freedBytes: z.number().int() }),
  },
  /** Mensagem enviada enquanto o Claude responde: espera na fila e começa quando a resposta atual terminar. */
  'chat:enqueue': { input: enqueueMessageSchema, output: z.array(queuedMessageSchema) },
  'chat:dequeue': {
    input: z.object({ conversationId: z.uuid(), id: z.string() }),
    output: z.array(queuedMessageSchema),
  },
  'chat:queues': {
    input: z.undefined(),
    output: z.array(z.object({ conversationId: z.uuid(), items: z.array(queuedMessageSchema) })),
  },
  /** Medição de contexto da conversa (dados reais do Claude Code, sem chamar a API) e os limites dos avisos. */
  'context:get': { input: z.object({ conversationId: z.uuid() }), output: contextStateSchema },
  /** Todas as conversas do Workspace com a medição de cada uma (painel geral de sessões). */
  'context:overview': { input: z.object({ workspaceId: z.uuid() }), output: contextOverviewSchema },
  /** O que "Continuar em nova conversa" vai fazer, para a confirmação (não executa nada). */
  'context:continuePreview': { input: z.object({ conversationId: z.uuid() }), output: continuationPreviewSchema },
  /** Copia a sessão, compacta a cópia e cria a conversa nova. A conversa original não é alterada. */
  'context:continue': { input: continueInputSchema, output: continueResultSchema },
  'context:thresholds': { input: z.undefined(), output: contextThresholdsSchema },
  'context:setThresholds': { input: contextThresholdsSchema, output: contextThresholdsSchema },
  'chat:undo': {
    input: z.object({ conversationId: z.uuid(), messageId: z.uuid(), dryRun: z.boolean() }),
    output: z.object({ files: z.array(z.string()) }),
  },
  'workspaces:setPermissionMode': {
    input: z.object({ id: z.uuid(), mode: permissionModeSchema }),
    output: workspaceSchema,
  },
  'permissions:respond': {
    input: z.object({
      requestId: z.string().min(1),
      decision: permissionDecisionSchema,
      answers: questionAnswersSchema.optional(),
    }),
    output: z.null(),
  },
  'permissions:pending': { input: z.undefined(), output: z.array(permissionRequestSchema) },
  'permissions:rules': { input: z.object({ workspaceId: z.uuid() }), output: z.array(permissionRuleSchema) },
  'permissions:removeRule': { input: z.object({ ruleId: z.uuid() }), output: z.null() },
  'permissions:audit': { input: z.object({ workspaceId: z.uuid() }), output: z.array(auditEntrySchema) },
  'files:reveal': { input: z.object({ workspaceId: z.uuid(), path: z.string().min(1) }), output: z.null() },
  'models:list': { input: z.object({ refresh: z.boolean() }), output: modelCatalogSchema },
  'conversations:setModel': {
    input: modelChoiceSchema.extend({ conversationId: z.uuid() }),
    output: conversationSchema,
  },
  'workspaces:setDefaultModel': { input: modelChoiceSchema.extend({ id: z.uuid() }), output: workspaceSchema },
  'projects:list': { input: z.object({ workspaceId: z.uuid() }), output: z.array(projectSchema) },
  'projects:inspectFolder': {
    input: z.object({ workspaceId: z.uuid(), path: z.string().trim().min(3, 'Informe o caminho da pasta') }),
    output: folderInspectionSchema,
  },
  'projects:pickFolder': { input: z.undefined(), output: z.string().nullable() },
  'projects:create': { input: createProjectSchema, output: projectSchema },
  'projects:setInstructions': { input: z.object({ id: z.uuid(), instructions: z.string() }), output: projectSchema },
  'projects:trust': { input: z.object({ id: z.uuid() }), output: projectSchema },
  'projects:revokeTrust': { input: z.object({ id: z.uuid() }), output: projectSchema },
  'projects:archive': { input: z.object({ id: z.uuid() }), output: z.null() },
  'projects:reorder': {
    input: z.object({ workspaceId: z.uuid(), ids: z.array(z.uuid()) }),
    output: z.array(projectSchema),
  },
  'projects:claudeSessions': { input: z.object({ projectId: z.uuid() }), output: z.array(claudeSessionSummarySchema) },
  'projects:importSession': {
    input: z.object({ projectId: z.uuid(), sessionId: z.uuid() }),
    output: conversationSchema,
  },
  'settings:getGlobalInstructions': { input: z.undefined(), output: z.object({ text: z.string() }) },
  'code:list': { input: codeScopeSchema.extend({ dir: z.string().max(1000) }), output: z.array(codeEntrySchema) },
  'code:read': { input: codeScopeSchema.extend({ path: z.string().min(1).max(1000) }), output: codeFileSchema },
  'code:write': {
    input: codeScopeSchema.extend({
      path: z.string().min(1).max(1000),
      content: z.string(),
      expectedMtimeMs: z.number(),
    }),
    output: z.object({ mtimeMs: z.number() }),
  },
  'code:openInVsCode': { input: codeScopeSchema.extend({ path: z.string().max(1000) }), output: z.null() },
  'code:changes': { input: z.object({ messageId: z.uuid() }), output: z.array(fileChangeSchema) },
  'code:relative': {
    input: codeScopeSchema.extend({ absolute: z.string().min(1).max(1000) }),
    output: z.object({ path: z.string().nullable() }),
  },
  /**
   * Abre um arquivo citado numa resposta do Claude: nota do vault (`note`), arquivo de texto do projeto (`code`) ou,
   * para o resto, mostra no Explorer (`revealed`). Só vale dentro das pastas do projeto e do Workspace.
   */
  'code:openLink': {
    input: codeScopeSchema.extend({ target: z.string().min(1).max(1000) }),
    output: z.object({ action: z.enum(['note', 'code', 'revealed']), path: z.string().nullable() }),
  },
  /** Cola (ou solta) arquivos e pastas de fora dentro de uma pasta do escopo. Não sobrescreve nada. */
  'code:import': {
    input: codeScopeSchema.extend({
      dir: z.string().max(1000),
      sources: z.array(z.string().min(1).max(1000)).min(1).max(200),
    }),
    output: z.object({ imported: z.array(z.string()) }),
  },
  /** Move um arquivo ou pasta do escopo para a Lixeira do sistema. */
  'code:delete': { input: codeScopeSchema.extend({ path: z.string().min(1).max(1000) }), output: z.null() },
  /** Cola dentro de uma pasta do escopo itens copiados na própria árvore. Não sobrescreve nada. */
  'code:copy': {
    input: codeScopeSchema.extend({
      dir: z.string().max(1000),
      paths: z.array(z.string().min(1).max(1000)).min(1).max(200),
    }),
    output: z.object({ imported: z.array(z.string()) }),
  },
  /** Renomeia um arquivo ou pasta do escopo (continua na mesma pasta). */
  'code:rename': {
    input: codeScopeSchema.extend({ path: z.string().min(1).max(1000), name: z.string().min(1).max(255) }),
    output: z.object({ path: z.string() }),
  },
  /** Mostra um item (ou a raiz, com path vazio) no Explorer do Windows. */
  'code:reveal': { input: codeScopeSchema.extend({ path: z.string().max(1000) }), output: z.null() },
  'knowledge:tree': { input: z.object({ workspaceId: z.uuid() }), output: noteTreeNodeSchema },
  'knowledge:graph': { input: z.object({ workspaceId: z.uuid() }), output: galaxyGraphSchema },
  /** Aparência que o usuário escolheu para os planetas do Workspace (só o que ele trocou). */
  'galaxy:styles': { input: z.object({ workspaceId: z.uuid() }), output: planetStylesSchema },
  /** Troca a aparência de um planeta; `override: null` volta ao sorteio. Devolve todas as escolhas. */
  'galaxy:setPlanet': {
    input: z.object({ workspaceId: z.uuid(), path: notePathSchema, override: planetOverrideSchema.nullable() }),
    output: planetStylesSchema,
  },
  'knowledge:read': { input: z.object({ workspaceId: z.uuid(), path: notePathSchema }), output: noteSchema },
  'knowledge:write': {
    input: z.object({ workspaceId: z.uuid(), path: notePathSchema, content: z.string(), expectedMtimeMs: z.number() }),
    output: z.object({ mtimeMs: z.number() }),
  },
  'knowledge:create': {
    input: z.object({
      workspaceId: z.uuid(),
      folder: notePathSchema,
      title: z.string().trim().min(1, 'Dê um nome à nota'),
    }),
    output: z.object({ path: z.string() }),
  },
  'knowledge:createFolder': {
    input: z.object({
      workspaceId: z.uuid(),
      parent: notePathSchema,
      title: z.string().trim().min(1, 'Dê um nome à pasta'),
    }),
    output: z.object({ path: z.string() }),
  },
  'knowledge:rename': {
    input: z.object({ workspaceId: z.uuid(), path: notePathSchema, title: z.string().trim().min(1, 'Dê um nome') }),
    output: z.object({ path: z.string() }),
  },
  'knowledge:move': {
    input: z.object({ workspaceId: z.uuid(), path: notePathSchema, folder: notePathSchema }),
    output: z.object({ path: z.string() }),
  },
  'knowledge:trash': { input: z.object({ workspaceId: z.uuid(), path: notePathSchema }), output: z.null() },
  'knowledge:links': { input: z.object({ workspaceId: z.uuid(), path: notePathSchema }), output: noteLinksSchema },
  'knowledge:resolve': {
    input: z.object({ workspaceId: z.uuid(), target: z.string().max(300), from: notePathSchema.optional() }),
    output: z.object({ path: z.string().nullable() }),
  },
  'settings:setGlobalInstructions': {
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
  },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType }>;

export type IpcContract = typeof ipcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;
