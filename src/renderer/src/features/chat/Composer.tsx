import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_MIMES, type Attachment } from '@shared/chat';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';
import { AttachmentChip } from './AttachmentChip';

interface ComposerProps {
  placeholder: string;
  disabled: boolean;
  disabledReason?: string;
  running: boolean;
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  /** Workspace onde os anexos são guardados; sem ele, anexar fica desligado. */
  workspaceId?: string | null;
  /** "Editar" numa mensagem antiga: devolve o texto e os anexos ao campo. */
  prefill?: { text: string; attachments: Attachment[]; nonce: number };
  /** Identifica a conversa: o texto ainda não enviado fica guardado por chave (sobrevive a trocar de conversa e a recarregar). */
  draftKey?: string;
  onStop: () => void;
  /** Controles na linha de baixo, à esquerda do botão de enviar (ex.: seletor de modelo). */
  footer?: ReactNode;
}

const DRAFT_PREFIX = 'nexus.draft.';

function readDraft(key?: string): string {
  if (!key) return '';
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string | undefined, text: string): void {
  if (!key) return;
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + key, text);
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // armazenamento indisponível: o rascunho só não sobrevive
  }
}

/** Campo de mensagem: Enter envia, Shift+Enter quebra linha. Durante a resposta, o botão vira "Parar". */
export function Composer({
  placeholder,
  disabled,
  disabledReason,
  running,
  onSend,
  onStop,
  footer,
  workspaceId,
  prefill,
  draftKey,
}: ComposerProps) {
  const [text, setText] = useState(() => readDraft(draftKey));
  const loadedKey = useRef(draftKey);
  useEffect(() => {
    if (loadedKey.current === draftKey) return;
    loadedKey.current = draftKey;
    setText(readDraft(draftKey));
  }, [draftKey]);
  useEffect(() => {
    writeDraft(draftKey, text);
    // Só o texto dispara a gravação: ao trocar de conversa, o texto novo (lido acima) é que vai para a chave nova.
  }, [text]);
  const [attachments, setAttachments] = useState<Array<Attachment & { thumb?: string | null }>>([]);
  const [uploading, setUploading] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canAttach = Boolean(workspaceId) && !disabled;

  // "Editar" numa mensagem antiga: o texto e os anexos voltam ao campo para mudar e reenviar.
  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    setAttachments(prefill.attachments.map((a) => ({ ...a })));
    setAttachError(null);
    ref.current?.focus();
  }, [prefill?.nonce]);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Com o Claude respondendo, dá para continuar escrevendo: a mensagem entra na fila.
  const canSend = !disabled && !sending && uploading === 0 && (text.trim().length > 0 || attachments.length > 0);

  // Cresce com o texto até o limite (max-h-48).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function send() {
    if (!canSend) return;
    setSending(true);
    const ok = await onSend(
      text.trim(),
      attachments.map(({ thumb: _thumb, ...a }) => a),
    );
    setSending(false);
    if (ok) {
      setText('');
      setAttachments([]);
    }
    ref.current?.focus();
  }

  /** Guarda os arquivos (colados, arrastados ou escolhidos) no Workspace e mostra um chip para cada um. */
  async function addFiles(files: File[]) {
    if (!workspaceId || files.length === 0) return;
    setAttachError(null);
    let room = ATTACHMENT_MAX_PER_MESSAGE - attachments.length;
    for (const file of files) {
      if (room <= 0) {
        setAttachError(`No máximo ${ATTACHMENT_MAX_PER_MESSAGE} arquivos por mensagem.`);
        break;
      }
      const mime = file.type as Attachment['mime'];
      if (!ATTACHMENT_MIMES.includes(mime)) {
        setAttachError(`"${file.name || 'arquivo'}": só imagens (PNG, JPG, GIF, WebP) e PDF.`);
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setAttachError(`"${file.name}" passa do limite de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      room--;
      setUploading((n) => n + 1);
      try {
        const saved = await invoke('attachments:save', {
          workspaceId,
          name: file.name || (mime === 'application/pdf' ? 'documento.pdf' : 'imagem.png'),
          mime,
          data: await toBase64(file),
        });
        const thumb = saved.mime.startsWith('image/')
          ? (await invoke('attachments:thumb', { workspaceId, attachment: saved })).dataUrl
          : null;
        setAttachments((list) => [...list, { ...saved, thumb }]);
      } catch (err) {
        room++;
        setAttachError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (!canAttach || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!canAttach || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        void addFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        'rounded-2xl border border-border bg-surface p-2 transition-colors focus-within:border-accent/60',
        disabled && 'opacity-60',
        dragging && 'border-accent bg-accent-soft',
      )}
      data-dragging={dragging || undefined}
    >
      {(attachments.length > 0 || uploading > 0 || attachError) && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1 pt-1" data-testid="composer-attachments">
          {workspaceId &&
            attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                workspaceId={workspaceId}
                attachment={a}
                preloaded={a.thumb}
                onRemove={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
              />
            ))}
          {uploading > 0 && <span className="text-xs text-muted">Anexando…</span>}
          {attachError && (
            <span role="alert" className="text-xs text-danger">
              {attachError}
            </span>
          )}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label="Escolher arquivos para anexar"
        accept={ATTACHMENT_MIMES.join(',')}
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <textarea
        ref={ref}
        value={text}
        disabled={disabled}
        rows={1}
        aria-label="Mensagem"
        placeholder={running ? 'Escreva a próxima mensagem: ela entra na fila…' : placeholder}
        title={disabled ? disabledReason : undefined}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // Print de tela ou arquivo copiado: vira anexo. Texto colado continua normal.
          if (!canAttach || e.clipboardData.files.length === 0) return;
          e.preventDefault();
          void addFiles([...e.clipboardData.files]);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        className="block max-h-48 min-h-9 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {workspaceId && (
            <button
              type="button"
              disabled={!canAttach}
              onClick={() => fileInput.current?.click()}
              aria-label="Anexar imagem ou PDF"
              title="Anexar imagem ou PDF (ou cole/arraste no campo)"
              className="grid size-8 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <Paperclip size={15} />
            </button>
          )}
          <div className="min-w-0">{footer}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {running && (
            <button
              type="button"
              onClick={onStop}
              aria-label="Parar resposta"
              title="Parar resposta"
              className="grid size-8 place-items-center rounded-xl bg-text text-bg transition hover:opacity-80"
            >
              <Square size={12} fill="currentColor" />
            </button>
          )}
          {(!running || text.trim().length > 0 || attachments.length > 0) && (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              aria-label={running ? 'Enviar para a fila' : 'Enviar mensagem'}
              title={running ? 'Enviar para a fila (começa quando a resposta atual terminar)' : undefined}
              className="grid size-8 place-items-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Conteúdo do arquivo em base64, sem o prefixo `data:`. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}
