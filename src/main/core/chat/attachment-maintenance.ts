import type { AttachmentService } from './attachment-service';
import type { ChatService } from './chat-service';
import type { WorkspaceService } from '../workspaces/workspace-service';

const DAY_MS = 86_400_000;
/** Anexo que nunca foi enviado (colado e removido, ou mensagem abandonada) some depois deste tempo. */
export const ORPHAN_MAX_AGE_DAYS = 3;

/**
 * Limpeza dos anexos guardados nos Workspaces. Automática, só apaga o que nunca foi enviado. Os anexos de mensagens
 * só são apagados quando o usuário pede (a mensagem continua na conversa, sem a miniatura), e os de mensagens que
 * ainda esperam na fila nunca são apagados.
 */
export class AttachmentMaintenance {
  constructor(
    private readonly deps: {
      workspaces: Pick<WorkspaceService, 'list'>;
      attachments: Pick<AttachmentService, 'usage' | 'prune'>;
      chat: Pick<ChatService, 'attachmentsInUse'>;
      now?: () => number;
    },
  ) {}

  usage(): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    for (const ws of this.deps.workspaces.list()) {
      const u = this.deps.attachments.usage(ws.id);
      count += u.count;
      bytes += u.bytes;
    }
    return { count, bytes };
  }

  /** Limpeza automática (ao abrir o app): só o que nunca foi enviado e já passou de alguns dias. */
  pruneOrphans(): { removed: number; freedBytes: number } {
    return this.run(ORPHAN_MAX_AGE_DAYS, undefined);
  }

  /** Limpeza pedida pelo usuário: tudo que passou de `olderThanDays` dias, inclusive anexos de mensagens. */
  cleanup(olderThanDays: number): { removed: number; freedBytes: number } {
    return this.run(ORPHAN_MAX_AGE_DAYS, olderThanDays);
  }

  private run(orphanDays: number, anyDays: number | undefined): { removed: number; freedBytes: number } {
    const now = (this.deps.now ?? Date.now)();
    let removed = 0;
    let freedBytes = 0;
    for (const ws of this.deps.workspaces.list()) {
      const { sent, queued } = this.deps.chat.attachmentsInUse(ws.id);
      const r = this.deps.attachments.prune(ws.id, {
        inUse: sent,
        queued,
        orphanMaxAgeMs: orphanDays * DAY_MS,
        anyMaxAgeMs: anyDays === undefined ? undefined : anyDays * DAY_MS,
        now,
      });
      removed += r.removed;
      freedBytes += r.freedBytes;
    }
    return { removed, freedBytes };
  }
}
