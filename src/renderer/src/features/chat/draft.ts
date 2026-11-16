import { z } from 'zod';
import { attachmentSchema, type Attachment } from '@shared/chat';

/**
 * Rascunho do campo de mensagem: o texto e os anexos ainda não enviados ficam guardados por conversa (ou por
 * Workspace/projeto, numa conversa nova). Sobrevivem a trocar de conversa ou de projeto, a recarregar e a fechar o app.
 */
export interface Draft {
  text: string;
  attachments: Attachment[];
}

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] };

const KEY = 'nexus.draft2.';
/** Formato antigo (só o texto, sem anexos): ainda é lido, para não perder o que ficou escrito antes da atualização. */
const LEGACY_KEY = 'nexus.draft.';

const stored = z.object({ text: z.string(), attachments: z.array(attachmentSchema) });

function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function readDraft(key: string | undefined, storage: Storage | null = browserStorage()): Draft {
  if (!key || !storage) return EMPTY_DRAFT;
  try {
    const raw = storage.getItem(KEY + key);
    if (raw) {
      const parsed = stored.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
    const legacy = storage.getItem(LEGACY_KEY + key);
    return legacy ? { text: legacy, attachments: [] } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

/** Grava o rascunho; vazio (sem texto e sem anexos) apaga a entrada. Os dois formatos são limpos juntos. */
export function writeDraft(key: string | undefined, draft: Draft, storage: Storage | null = browserStorage()): void {
  if (!key || !storage) return;
  try {
    storage.removeItem(LEGACY_KEY + key);
    if (draft.text || draft.attachments.length > 0) {
      storage.setItem(
        KEY + key,
        JSON.stringify({
          text: draft.text,
          // Só os campos do contrato: a miniatura (data URL) é refeita ao voltar, não vai para o armazenamento.
          attachments: draft.attachments.map(({ id, name, mime, size }) => ({ id, name, mime, size })),
        }),
      );
    } else storage.removeItem(KEY + key);
  } catch {
    // armazenamento cheio ou indisponível: o rascunho só não sobrevive
  }
}
