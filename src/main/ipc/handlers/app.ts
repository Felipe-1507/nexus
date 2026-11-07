import type { AppInfo, OpenablePath } from '@shared/ipc-contract';
import { NexusError } from '@shared/ipc-result';
import type { AppPaths } from '../../platform/paths';

export interface AppHandlerDeps {
  appVersion: string;
  paths: AppPaths;
  schemaVersion: number;
  sqliteVersion: string;
}

export function getAppInfo(deps: AppHandlerDeps): AppInfo {
  return {
    appVersion: deps.appVersion,
    versions: {
      electron: process.versions.electron ?? '',
      node: process.versions.node,
      chrome: process.versions.chrome ?? '',
    },
    platform: process.platform,
    paths: {
      userData: deps.paths.userData,
      dataRoot: deps.paths.dataRoot,
      database: deps.paths.database,
      logs: deps.paths.logs,
    },
    database: { schemaVersion: deps.schemaVersion, sqliteVersion: deps.sqliteVersion },
  };
}

/** Abre no Explorer uma das pastas conhecidas do app. `shellOpen` devolve mensagem de erro ou string vazia. */
export async function openKnownPath(
  key: OpenablePath,
  paths: AppPaths,
  shellOpen: (path: string) => Promise<string>,
): Promise<null> {
  const target = { userData: paths.userData, logs: paths.logs }[key];
  const error = await shellOpen(target);
  if (error) throw new NexusError('NOT_FOUND', `Não foi possível abrir a pasta: ${error}`);
  return null;
}
