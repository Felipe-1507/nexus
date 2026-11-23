import type { BackupService } from '../../core/backup/backup-service';
import type { IpcHandlers } from '../dispatcher';

type BackupHandlers = Pick<IpcHandlers, 'backup:preview' | 'backup:export'>;

export function backupHandlers(
  backup: BackupService,
  /** Pergunta onde salvar; `null` = o usuário cancelou. */
  pickTarget: (suggestedName: string) => Promise<string | null>,
): BackupHandlers {
  return {
    'backup:preview': () => ({ ...backup.preview(), suggestedName: backup.suggestedName() }),
    'backup:export': async () => {
      const target = await pickTarget(backup.suggestedName());
      return target ? backup.export(target) : null;
    },
  };
}
