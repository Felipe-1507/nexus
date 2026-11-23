import type { ExtensionsProbe } from '@shared/extensions';
import { readDeclaredExtensions } from '../../core/extensions/extensions-config';
import type { IpcHandlers } from '../dispatcher';

type ExtensionsHandlers = Pick<IpcHandlers, 'extensions:list' | 'extensions:probe'>;

export function extensionsHandlers(deps: {
  home: string;
  projects: (workspaceId: string) => Promise<Array<{ id: string; name: string; path: string }>>;
  probe: (workspaceId: string, projectId: string | null) => Promise<ExtensionsProbe>;
}): ExtensionsHandlers {
  return {
    'extensions:list': async ({ workspaceId }) =>
      readDeclaredExtensions({ home: deps.home, projects: await deps.projects(workspaceId) }),
    'extensions:probe': ({ workspaceId, projectId }) => deps.probe(workspaceId, projectId),
  };
}
