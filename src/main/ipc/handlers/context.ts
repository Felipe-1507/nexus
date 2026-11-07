import type { ChatService } from '../../core/chat/chat-service';
import type { IpcHandlers } from '../dispatcher';

type ContextHandlers = Pick<
  IpcHandlers,
  | 'context:get'
  | 'context:overview'
  | 'context:continuePreview'
  | 'context:continue'
  | 'context:thresholds'
  | 'context:setThresholds'
>;

export function contextHandlers(chat: ChatService): ContextHandlers {
  return {
    'context:get': ({ conversationId }) => chat.contextState(conversationId),
    'context:overview': ({ workspaceId }) => chat.context.overview(workspaceId),
    'context:continuePreview': ({ conversationId }) => chat.continuationPreview(conversationId),
    'context:continue': (input) => chat.continueInNewConversation(input),
    'context:thresholds': () => chat.context.thresholds(),
    'context:setThresholds': (thresholds) => chat.context.setThresholds(thresholds),
  };
}
