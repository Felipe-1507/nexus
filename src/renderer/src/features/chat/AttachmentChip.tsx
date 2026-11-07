import { FileText, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Attachment } from '@shared/chat';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';

/** Miniatura de uma imagem anexada (gerada pelo main; PDF e arquivo ausente não têm). */
export function useAttachmentThumb(workspaceId: string, attachment: Attachment, preloaded?: string | null) {
  return useQuery({
    queryKey: ['attachment-thumb', workspaceId, attachment.id],
    queryFn: async () => (await invoke('attachments:thumb', { workspaceId, attachment })).dataUrl,
    enabled: preloaded === undefined && attachment.mime.startsWith('image/'),
    staleTime: Infinity,
    initialData: preloaded,
  }).data;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Anexo com miniatura (ou ícone de PDF). Com `onRemove`, vira o chip do campo de mensagem. */
export function AttachmentChip({
  workspaceId,
  attachment,
  preloaded,
  onRemove,
  className,
}: {
  workspaceId: string;
  attachment: Attachment;
  preloaded?: string | null;
  onRemove?: () => void;
  className?: string;
}) {
  const thumb = useAttachmentThumb(workspaceId, attachment, preloaded);
  return (
    <div
      data-testid="attachment"
      className={cn(
        'flex max-w-56 items-center gap-2 rounded-xl border border-border bg-surface-2 p-1.5 pr-2',
        className,
      )}
    >
      {thumb ? (
        <img src={thumb} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted">
          <FileText size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{attachment.name}</span>
        <span className="block text-[10px] text-muted">{formatSize(attachment.size)}</span>
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remover anexo ${attachment.name}`}
          onClick={onRemove}
          className="rounded p-0.5 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
