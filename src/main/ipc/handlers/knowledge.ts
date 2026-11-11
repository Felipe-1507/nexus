import type { KnowledgeService } from '../../core/knowledge/knowledge-service';
import type { IpcHandlers } from '../dispatcher';
import type { PlanetStyleStore } from '../../core/knowledge/planet-styles';

type KnowledgeHandlers = Pick<
  IpcHandlers,
  | 'knowledge:tree'
  | 'knowledge:graph'
  | 'galaxy:styles'
  | 'galaxy:setPlanet'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'knowledge:create'
  | 'knowledge:createFolder'
  | 'knowledge:rename'
  | 'knowledge:move'
  | 'knowledge:trash'
  | 'knowledge:links'
  | 'knowledge:resolve'
  | 'knowledge:openAttachment'
>;

export function knowledgeHandlers(knowledge: KnowledgeService, planets: PlanetStyleStore): KnowledgeHandlers {
  return {
    'knowledge:tree': ({ workspaceId }) => knowledge.tree(workspaceId),
    'knowledge:graph': ({ workspaceId }) => knowledge.graph(workspaceId),
    'galaxy:styles': ({ workspaceId }) => planets.get(workspaceId),
    'galaxy:setPlanet': ({ workspaceId, path, override }) => planets.set(workspaceId, path, override),
    'knowledge:read': ({ workspaceId, path }) => knowledge.read(workspaceId, path),
    'knowledge:write': ({ workspaceId, path, content, expectedMtimeMs }) =>
      knowledge.write(workspaceId, path, content, expectedMtimeMs),
    'knowledge:create': ({ workspaceId, folder, title }) => ({ path: knowledge.create(workspaceId, folder, title) }),
    'knowledge:createFolder': ({ workspaceId, parent, title }) => ({
      path: knowledge.createFolder(workspaceId, parent, title),
    }),
    'knowledge:rename': ({ workspaceId, path, title }) => ({ path: knowledge.rename(workspaceId, path, title) }),
    'knowledge:move': ({ workspaceId, path, folder }) => ({ path: knowledge.move(workspaceId, path, folder) }),
    'knowledge:trash': ({ workspaceId, path }) => {
      knowledge.trash(workspaceId, path);
      return null;
    },
    'knowledge:links': ({ workspaceId, path }) => knowledge.links(workspaceId, path),
    'knowledge:resolve': async ({ workspaceId, target, from }) => ({
      path: await knowledge.resolveLink(workspaceId, target, from),
    }),
    'knowledge:openAttachment': async ({ workspaceId, note, name, reveal }) => {
      await knowledge.openAttachment(workspaceId, note, name, reveal);
      return null;
    },
  };
}
