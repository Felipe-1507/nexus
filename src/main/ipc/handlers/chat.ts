import type { ChatService } from '../../core/chat/chat-service';
import type { IpcHandlers } from '../dispatcher';
import type { AttachmentMaintenance } from '../../core/chat/attachment-maintenance';
import type { AttachmentService } from '../../core/chat/attachment-service';

type ChatHandlers = Pick<
  IpcHandlers,
  | 'conversations:list'
  | 'conversations:messages'
  | 'conversations:archive'
  | 'conversations:sync'
  | 'conversations:setModel'
  | 'chat:send'
  | 'chat:interrupt'
  | 'chat:enqueue'
  | 'chat:dequeue'
  | 'attachments:save'
  | 'attachments:thumb'
  | 'attachments:usage'
  | 'attachments:cleanup'
>;

export function chatHandlers(
  chat: ChatService,
  attachments: AttachmentService,
  maintenance: AttachmentMaintenance,
): ChatHandlers {
  return {
    'conversations:list': ({ workspaceId, projectId }) => chat.listConversations(workspaceId, projectId),
    'conversations:messages': ({ conversationId }) => chat.listMessages(conversationId),
    'conversations:archive': ({ conversationId }) => {
      chat.archive(conversationId);
      return null;
    },
    'conversations:sync': ({ conversationId }) => chat.syncFromClaudeCode(conversationId),
    'conversations:setModel': ({ conversationId, model, effort }) => chat.setModel(conversationId, { model, effort }),
    'chat:send': (input) => chat.send(input),
    'attachments:usage': () => maintenance.usage(),
    'attachments:cleanup': ({ olderThanDays }) => maintenance.cleanup(olderThanDays),
    'attachments:save': (input) => attachments.save(input),
    'attachments:thumb': ({ workspaceId, attachment }) => ({
      dataUrl: attachments.thumbnail(workspaceId, attachment),
    }),
    'chat:enqueue': (input) => chat.enqueue(input),
    'chat:dequeue': ({ conversationId, id }) => chat.dequeue(conversationId, id),
    'chat:interrupt': async ({ conversationId }) => {
      await chat.interrupt(conversationId);
      return null;
    },
  };
}
