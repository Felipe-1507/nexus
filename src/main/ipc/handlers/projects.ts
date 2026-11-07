import type { ChatService } from '../../core/chat/chat-service';
import type { GlobalInstructions } from '../../core/context/global-instructions';
import type { ProjectService } from '../../core/projects/project-service';
import type { IpcHandlers } from '../dispatcher';

type ProjectHandlers = Pick<
  IpcHandlers,
  | 'projects:list'
  | 'projects:inspectFolder'
  | 'projects:pickFolder'
  | 'projects:create'
  | 'projects:setInstructions'
  | 'projects:trust'
  | 'projects:revokeTrust'
  | 'projects:archive'
  | 'projects:reorder'
  | 'projects:claudeSessions'
  | 'projects:importSession'
  | 'settings:getGlobalInstructions'
  | 'settings:setGlobalInstructions'
>;

export function projectHandlers(deps: {
  projects: ProjectService;
  chat: ChatService;
  global: GlobalInstructions;
  /** Seletor de pastas nativo; devolve null se o usuário cancelar. */
  pickFolder: () => Promise<string | null>;
}): ProjectHandlers {
  const { projects, chat, global } = deps;
  return {
    'projects:list': ({ workspaceId }) => projects.list(workspaceId),
    'projects:inspectFolder': ({ workspaceId, path }) => projects.inspectFolder(workspaceId, path),
    'projects:pickFolder': () => deps.pickFolder(),
    'projects:create': (input) => projects.create(input),
    'projects:setInstructions': ({ id, instructions }) => projects.setInstructions(id, instructions),
    'projects:trust': ({ id }) => projects.trustConfig(id),
    'projects:revokeTrust': ({ id }) => projects.revokeTrust(id),
    'projects:archive': ({ id }) => {
      projects.archive(id);
      return null;
    },
    'projects:reorder': ({ workspaceId, ids }) => projects.reorder(workspaceId, ids),
    'projects:claudeSessions': ({ projectId }) => chat.listClaudeSessions(projectId),
    'projects:importSession': ({ projectId, sessionId }) => chat.importSession(projectId, sessionId),
    'settings:getGlobalInstructions': () => ({ text: global.get() }),
    'settings:setGlobalInstructions': ({ text }) => ({ text: global.set(text) }),
  };
}
