import { z } from 'zod';
import { effortSchema, modelIdSchema } from './models';
import type { PermissionRequest } from './permissions';

/** Algo que o Claude fez durante a resposta. Fica escondido em "Ver detalhes" no modo minimalista. */
export const activitySchema = z.object({
  kind: z.enum(['tool', 'intermediate']),
  /** Frase curta em pt-BR ("Leu nota.md") ou, para `intermediate`, o texto que o Claude escreveu antes de agir. */
  label: z.string(),
  /** Caminho, padrão de busca ou comando completo. */
  detail: z.string().optional(),
  /** Arquivo criado ou editado (vira cartão na resposta e habilita o "Desfazer"). */
  changedFile: z.string().optional(),
  error: z.boolean().optional(),
});
export type Activity = z.infer<typeof activitySchema>;

/** Tipos de anexo aceitos no chat (o Claude lê imagens e PDFs com a ferramenta Read). */
export const ATTACHMENT_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_MESSAGE = 5;

/** Arquivo anexado a uma mensagem: guardado em `.nexus/anexos` do Workspace (o caminho é derivado do id). */
export const attachmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  mime: z.enum(ATTACHMENT_MIMES),
  size: z.number().int().nonnegative(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const messageStatusSchema = z.enum(['complete', 'interrupted', 'error']);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  seq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  /** Para o assistente: só a resposta final. */
  content: z.string(),
  status: messageStatusSchema,
  error: z.string().nullable(),
  activities: z.array(activitySchema),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  /** Quando as alterações de arquivos desta resposta foram desfeitas. */
  undoneAt: z.string().nullable(),
  /** Modelo que respondeu (só respostas do assistente). */
  model: z.string().nullable(),
  /** Arquivos anexados (só mensagens do usuário). */
  attachments: z.array(attachmentSchema),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** Projeto da conversa; `null` = conversa geral do Workspace. */
  projectId: z.string().nullable(),
  title: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Uma resposta está sendo gerada agora. */
  running: z.boolean(),
  /** Escolha desta conversa; `null` = herdar do Workspace. */
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
  /** Conversa de onde esta foi continuada ("Continuar em nova conversa"); `null` = conversa comum. */
  forkedFrom: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const MESSAGE_MAX_CHARS = 100_000;

export const sendMessageSchema = z
  .object({
    workspaceId: z.uuid(),
    /** Ausente para começar uma conversa nova. */
    conversationId: z.uuid().optional(),
    /** Só para conversa nova: projeto onde ela roda (ausente = conversa geral do Workspace). */
    projectId: z.uuid().optional(),
    text: z.string().trim().max(MESSAGE_MAX_CHARS, 'Mensagem longa demais'),
    attachments: z.array(attachmentSchema).max(ATTACHMENT_MAX_PER_MESSAGE).optional(),
    /** Só para conversa nova: modelo e esforço escolhidos antes da primeira mensagem. */
    model: modelIdSchema.nullable().optional(),
    effort: effortSchema.nullable().optional(),
  })
  .refine((m) => m.text.length > 0 || (m.attachments?.length ?? 0) > 0, {
    message: 'Escreva uma mensagem',
    path: ['text'],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const sendMessageResultSchema = z.object({
  conversation: conversationSchema,
  userMessage: chatMessageSchema,
  assistantMessageId: z.string(),
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;

/** Mensagem na fila: enviada enquanto o Claude ainda responde, espera a vez no processo principal. */
export const queuedMessageSchema = z.object({ id: z.string(), text: z.string(), attachments: z.number().int() });
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;

export const enqueueMessageSchema = z
  .object({
    workspaceId: z.uuid(),
    conversationId: z.uuid(),
    text: z.string().trim().max(MESSAGE_MAX_CHARS, 'Mensagem longa demais'),
    attachments: z.array(attachmentSchema).max(ATTACHMENT_MAX_PER_MESSAGE).optional(),
  })
  .refine((m) => m.text.length > 0 || (m.attachments?.length ?? 0) > 0, {
    message: 'Escreva uma mensagem',
    path: ['text'],
  });

/** Eventos de uma resposta em andamento, enviados do main para a tela pelo canal `chat:event`. */
export type ChatEvent =
  | { type: 'text'; conversationId: string; assistantMessageId: string; text: string }
  | { type: 'reset-draft'; conversationId: string; assistantMessageId: string }
  | { type: 'activity'; conversationId: string; assistantMessageId: string; activity: Activity }
  | { type: 'turn-end'; conversationId: string; message: ChatMessage }
  /** Uma mensagem da fila começou a ser respondida: a tela mostra a mensagem do usuário e a nova resposta. */
  | { type: 'turn-start'; conversationId: string; userMessage: ChatMessage; assistantMessageId: string }
  /** O Claude começou a responder por conta própria (ex.: a tarefa em segundo plano terminou), sem mensagem do usuário. */
  | { type: 'spontaneous-start'; conversationId: string; assistantMessageId: string }
  /** A resposta espontânea terminou sem nada para mostrar: a tela só tira o "respondendo". */
  | { type: 'turn-discard'; conversationId: string }
  /** A fila da conversa mudou. `error`: a mensagem que ia começar não pôde ser enviada (foi descartada). */
  | { type: 'queue'; conversationId: string; items: QueuedMessage[]; error?: string }
  | { type: 'permission-request'; conversationId: string; request: PermissionRequest }
  | { type: 'permission-resolved'; conversationId: string; requestId: string };

export const CHAT_EVENT_CHANNEL = 'chat:event';
