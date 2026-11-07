import type { FileChange } from '@shared/code';

/** Acima disso o conteúdo não é guardado (só o nome do arquivo aparece, sem diff). */
export const CHANGE_MAX_CHARS = 1_000_000;

interface Tracked {
  kind: FileChange['kind'];
  before: string | null;
  after: string | null;
  truncated: boolean;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Reconstrói o antes e o depois de cada arquivo alterado num turno a partir dos resultados estruturados das
 * ferramentas do Claude Code (`tool_use_result`), sem ler o disco:
 * - Write: `{ type: 'create' | 'update', content, originalFile }`;
 * - Edit: `{ originalFile, oldString, newString, replaceAll }`.
 * O "antes" é o original da primeira alteração; o "depois" aplica as alterações em sequência.
 */
export class FileChangeTracker {
  private readonly files = new Map<string, Tracked>();

  record(result: unknown): void {
    if (!result || typeof result !== 'object') return;
    const r = result as Record<string, unknown>;
    const filePath = str(r.filePath);
    if (!filePath || !('originalFile' in r)) return; // Read, Bash etc. não alteram arquivos aqui
    const original = r.originalFile === null ? null : str(r.originalFile);
    const current = this.files.get(filePath);

    let after: string | null | undefined;
    if (typeof r.content === 'string' && (r.type === 'create' || r.type === 'update')) {
      after = r.content;
    } else if (typeof r.oldString === 'string' && typeof r.newString === 'string') {
      const base = current ? current.after : (original ?? null);
      after =
        base === null
          ? null
          : r.replaceAll === true
            ? base.split(r.oldString).join(r.newString)
            : base.replace(r.oldString, () => r.newString as string);
    }
    if (after === undefined) return;

    const tracked: Tracked = current ?? {
      kind: original === null && r.type === 'create' ? 'create' : 'edit',
      before: original ?? null,
      after: null,
      truncated: false,
    };
    tracked.after = after;
    tracked.truncated ||=
      after === null || (tracked.before?.length ?? 0) > CHANGE_MAX_CHARS || after.length > CHANGE_MAX_CHARS;
    if (tracked.kind === 'edit' && tracked.before === null && original === undefined) tracked.truncated = true;
    this.files.set(filePath, tracked);
  }

  list(): FileChange[] {
    return [...this.files.entries()].map(([path, t]) => ({
      path,
      kind: t.kind,
      before: t.truncated ? null : t.before,
      after: t.truncated ? null : t.after,
      truncated: t.truncated,
    }));
  }
}
