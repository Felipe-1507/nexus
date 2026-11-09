import fs from 'node:fs';
import { NexusError } from '@shared/ipc-result';
import { isInside } from '../../agent/permission-policy';
import type { ChatService } from '../../core/chat/chat-service';
import type { PermissionsService } from '../../core/permissions/permissions-service';
import type { WorkspaceService } from '../../core/workspaces/workspace-service';
import type { IpcHandlers } from '../dispatcher';

type PermissionHandlers = Pick<
  IpcHandlers,
  | 'chat:undo'
  | 'workspaces:setPermissionMode'
  | 'permissions:respond'
  | 'permissions:pending'
  | 'permissions:rules'
  | 'permissions:removeRule'
  | 'permissions:audit'
  | 'files:reveal'
>;

export function permissionHandlers(deps: {
  chat: ChatService;
  permissions: PermissionsService;
  workspaces: WorkspaceService;
  reveal: (path: string) => void;
}): PermissionHandlers {
  const { chat, permissions, workspaces } = deps;
  return {
    'chat:undo': ({ conversationId, messageId, dryRun }) => chat.undo(conversationId, messageId, dryRun),
    'workspaces:setPermissionMode': ({ id, mode }) => workspaces.setPermissionMode(id, mode),
    'permissions:respond': ({ requestId, decision, answers }) => {
      permissions.respond(requestId, decision, answers);
      return null;
    },
    'permissions:pending': () => permissions.pending(),
    'permissions:rules': ({ workspaceId }) => {
      workspaces.get(workspaceId);
      return permissions.listRules(workspaceId);
    },
    'permissions:removeRule': ({ ruleId }) => {
      permissions.removeRule(ruleId);
      return null;
    },
    'permissions:audit': ({ workspaceId }) => {
      workspaces.get(workspaceId);
      return permissions.listAudit(workspaceId);
    },
    // Mostra o arquivo no Explorer (nunca o executa) e só dentro da pasta do Workspace.
    'files:reveal': ({ workspaceId, path }) => {
      const root = workspaces.get(workspaceId).rootPath;
      if (!isInside(root, path, root, process.platform) || !fs.existsSync(path)) {
        throw new NexusError('NOT_FOUND', 'Arquivo não encontrado neste Workspace.');
      }
      deps.reveal(path);
      return null;
    },
  };
}
