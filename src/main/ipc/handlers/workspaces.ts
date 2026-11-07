import type { WorkspaceService } from '../../core/workspaces/workspace-service';
import { NexusError } from '@shared/ipc-result';
import type { IpcHandlers } from '../dispatcher';

type WorkspaceHandlers = Pick<
  IpcHandlers,
  | 'workspaces:list'
  | 'workspaces:create'
  | 'workspaces:update'
  | 'workspaces:archive'
  | 'workspaces:setActive'
  | 'workspaces:openFolder'
  | 'workspaces:readInstructions'
  | 'workspaces:saveInstructions'
>;

export function workspaceHandlers(
  service: WorkspaceService,
  shellOpen: (path: string) => Promise<string>,
): WorkspaceHandlers {
  return {
    'workspaces:list': () => ({ workspaces: service.list(), activeId: service.getActiveId() }),
    'workspaces:create': (input) => service.create(input),
    'workspaces:update': (input) => service.update(input),
    'workspaces:archive': ({ id }) => {
      service.archive(id);
      return null;
    },
    'workspaces:setActive': ({ id }) => {
      service.setActive(id);
      return null;
    },
    'workspaces:openFolder': async ({ id }) => {
      const error = await shellOpen(service.get(id).rootPath);
      if (error) throw new NexusError('NOT_FOUND', `Não foi possível abrir a pasta: ${error}`);
      return null;
    },
    'workspaces:readInstructions': ({ id }) => service.readInstructions(id),
    'workspaces:saveInstructions': ({ id, content, expectedMtimeMs }) =>
      service.saveInstructions(id, content, expectedMtimeMs),
  };
}
