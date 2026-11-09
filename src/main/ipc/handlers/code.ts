import type { ChatService } from '../../core/chat/chat-service';
import type { CodeService } from '../../core/code/code-service';
import type { FileOpener } from '../../core/code/file-opener';
import type { IpcHandlers } from '../dispatcher';

type CodeHandlers = Pick<
  IpcHandlers,
  | 'code:list'
  | 'code:read'
  | 'code:write'
  | 'code:openInVsCode'
  | 'code:changes'
  | 'code:relative'
  | 'code:openLink'
  | 'code:import'
  | 'code:delete'
  | 'code:copy'
  | 'code:rename'
  | 'code:reveal'
>;

export function codeHandlers(deps: {
  code: CodeService;
  files: FileOpener;
  chat: ChatService;
  /** Abre um endereço `vscode://` já validado pelo CodeService. */
  openUrl: (url: string) => Promise<void>;
}): CodeHandlers {
  const { code, chat } = deps;
  const scope = (i: { workspaceId: string; projectId: string | null }) => ({
    workspaceId: i.workspaceId,
    projectId: i.projectId,
  });
  return {
    'code:list': (i) => code.list(scope(i), i.dir),
    'code:read': (i) => code.read(scope(i), i.path),
    'code:write': (i) => code.write(scope(i), i.path, i.content, i.expectedMtimeMs),
    'code:openInVsCode': async (i) => {
      await deps.openUrl(await code.vscodeUrl(scope(i), i.path));
      return null;
    },
    'code:changes': ({ messageId }) => chat.fileChanges(messageId),
    'code:openLink': (i) => deps.files.open(scope(i), i.target),
    'code:import': (i) => code.importPaths(scope(i), i.dir, i.sources),
    'code:delete': async (i) => {
      await code.remove(scope(i), i.path);
      return null;
    },
    'code:copy': (i) => code.copyEntries(scope(i), i.dir, i.paths),
    'code:rename': (i) => code.rename(scope(i), i.path, i.name),
    'code:reveal': async (i) => {
      await code.reveal(scope(i), i.path);
      return null;
    },
    'code:relative': async (i) => ({ path: await code.relativeTo(scope(i), i.absolute) }),
  };
}
