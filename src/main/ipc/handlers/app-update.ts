import type { AppUpdateService } from '../../agent/app-update';
import { checkSource } from '../../agent/app-update';
import type { IpcHandlers } from '../dispatcher';

type AppUpdateHandlers = Pick<
  IpcHandlers,
  'appUpdate:settings' | 'appUpdate:setSettings' | 'appUpdate:status' | 'appUpdate:install'
>;

export function appUpdateHandlers(
  update: AppUpdateService,
  /** Grava a origem e devolve o valor guardado. */
  saveSource: (source: string | null) => string | null,
  readSource: () => string | null,
): AppUpdateHandlers {
  return {
    'appUpdate:settings': () => ({ source: readSource() }),
    'appUpdate:setSettings': ({ source }) => {
      const clean = source?.trim() ? source.trim() : null;
      if (clean) checkSource(clean); // recusa endereço inseguro antes de gravar
      return { source: saveSource(clean) };
    },
    'appUpdate:status': ({ refresh }) => update.check(refresh),
    'appUpdate:install': () => update.install(),
  };
}
