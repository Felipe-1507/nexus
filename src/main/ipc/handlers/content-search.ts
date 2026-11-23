import { NexusError } from '@shared/ipc-result';
import { parseQuery } from '../../core/chat/search-text';
import { searchNotes, searchProjects } from '../../core/search/content-search';
import type { IpcHandlers } from '../dispatcher';

type ContentSearchHandlers = Pick<IpcHandlers, 'search:content'>;

export function contentSearchHandlers(deps: {
  notes: (workspaceId: string) => AsyncIterable<{ path: string; title: string; text: string }>;
  projects: (workspaceId: string, projectId?: string) => Promise<Array<{ id: string; name: string; path: string }>>;
}): ContentSearchHandlers {
  return {
    'search:content': async ({ workspaceId, query, kind, projectId }) => {
      const terms = parseQuery(query);
      if (terms.length === 0) throw new NexusError('VALIDATION', 'Escreva o que procurar.');
      if (kind === 'notes') return searchNotes(deps.notes(workspaceId), terms);
      return searchProjects(await deps.projects(workspaceId, projectId), terms);
    },
  };
}
