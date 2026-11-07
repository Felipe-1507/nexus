import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_MAX_BYTES, type Attachment } from '@shared/chat';
import { NexusError } from '@shared/ipc-result';
import { META_DIR, type WorkspaceService } from '../workspaces/workspace-service';

/** Pasta dos anexos de um Workspace. Fica em `.nexus` (oculta, fora do vault e da árvore de código). */
export const ATTACHMENTS_DIR = 'anexos';

type Mime = Attachment['mime'];
const EXTENSIONS: Record<Mime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/** O conteúdo precisa ser mesmo do tipo declarado (o nome e o tipo vêm do navegador e não bastam). */
export function sniffMime(bytes: Buffer): Mime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachmentServiceDeps {
  workspaces: Pick<WorkspaceService, 'get'>;
  newId?: () => string;
  /** Miniatura em data URL (a lib de imagens é do Electron, então vem de fora). */
  thumbnail?: (file: string) => string | null;
}

/** Arquivos que o usuário cola ou arrasta no chat, guardados no Workspace até serem enviados ao Claude. */
export class AttachmentService {
  constructor(private readonly deps: AttachmentServiceDeps) {}

  dir(workspaceId: string): string {
    return path.join(this.deps.workspaces.get(workspaceId).rootPath, META_DIR, ATTACHMENTS_DIR);
  }

  save(input: { workspaceId: string; name: string; mime: Mime; data: string }): Attachment {
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length === 0) throw new NexusError('VALIDATION', 'O arquivo está vazio.');
    if (bytes.length > ATTACHMENT_MAX_BYTES) {
      throw new NexusError('VALIDATION', `O arquivo passa do limite de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
    }
    const real = sniffMime(bytes);
    if (real !== input.mime) {
      throw new NexusError('VALIDATION', 'O conteúdo do arquivo não é do tipo informado (só imagens e PDF).');
    }
    const id = this.deps.newId?.() ?? crypto.randomUUID();
    const dir = this.dir(input.workspaceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}${EXTENSIONS[real]}`), bytes, { flag: 'wx' });
    return { id, name: displayName(input.name), mime: real, size: bytes.length };
  }

  /** Caminho do anexo no disco. Só aceita ids de anexos já guardados (nunca um caminho vindo da tela). */
  pathOf(workspaceId: string, attachment: Attachment): string {
    if (!UUID.test(attachment.id)) throw new NexusError('VALIDATION', 'Anexo inválido.');
    const file = path.join(this.dir(workspaceId), `${attachment.id}${EXTENSIONS[attachment.mime]}`);
    if (!fs.existsSync(file)) throw new NexusError('NOT_FOUND', `O anexo "${attachment.name}" não foi encontrado.`);
    return file;
  }

  /** Arquivos guardados no Workspace, com o id (o nome do arquivo sem a extensão), o tamanho e a data. */
  list(workspaceId: string): Array<{ id: string; file: string; size: number; mtimeMs: number }> {
    const dir = this.dir(workspaceId);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: Array<{ id: string; file: string; size: number; mtimeMs: number }> = [];
    for (const name of names) {
      const id = path.parse(name).name;
      if (!UUID.test(id)) continue; // só mexe no que o próprio Nexus guardou
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.isFile()) out.push({ id, file: path.join(dir, name), size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Sumiu durante a leitura: segue.
      }
    }
    return out;
  }

  /** Quantos arquivos há e quanto espaço ocupam. */
  usage(workspaceId: string): { count: number; bytes: number } {
    const files = this.list(workspaceId);
    return { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
  }

  /**
   * Apaga anexos antigos. `inUse`: ids que aparecem em mensagens; `queued`: ids de mensagens ainda na fila (nunca
   * apagados). Um anexo que nunca foi enviado some depois de `orphanMaxAgeMs`; os que estão em mensagens só somem se
   * `anyMaxAgeMs` for informado e já tiverem passado dele (a mensagem continua na conversa, sem a miniatura).
   */
  prune(
    workspaceId: string,
    opts: {
      inUse: ReadonlySet<string>;
      queued: ReadonlySet<string>;
      orphanMaxAgeMs: number;
      anyMaxAgeMs?: number;
      now: number;
    },
  ): { removed: number; freedBytes: number } {
    let removed = 0;
    let freedBytes = 0;
    for (const f of this.list(workspaceId)) {
      if (opts.queued.has(f.id)) continue;
      const age = opts.now - f.mtimeMs;
      const expired = opts.inUse.has(f.id)
        ? opts.anyMaxAgeMs !== undefined && age > opts.anyMaxAgeMs
        : age > opts.orphanMaxAgeMs;
      if (!expired) continue;
      try {
        fs.rmSync(f.file, { force: true });
        removed++;
        freedBytes += f.size;
      } catch {
        // Em uso ou sem permissão: fica para a próxima limpeza.
      }
    }
    return { removed, freedBytes };
  }

  thumbnail(workspaceId: string, attachment: Attachment): string | null {
    if (!attachment.mime.startsWith('image/')) return null;
    try {
      return this.deps.thumbnail?.(this.pathOf(workspaceId, attachment)) ?? null;
    } catch {
      return null;
    }
  }
}

/** Caracteres de controle (0x00 a 0x1f) não entram em nomes mostrados na tela. */
const isControl = (ch: string) => ch.charCodeAt(0) < 0x20;

/** Nome para mostrar: sem pastas e sem caracteres de controle. */
function displayName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  return (
    [...base]
      .filter((ch) => !isControl(ch))
      .join('')
      .trim()
      .slice(0, 200) || 'anexo'
  );
}
