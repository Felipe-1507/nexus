import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NexusError } from '@shared/ipc-result';
import type { BackupResult } from '@shared/backup';
import { ZipWriter, type ZipLimits } from '../../fs/zip-writer';

/**
 * Backup manual: um .zip com o banco (conversas, Workspaces, permissões), as preferências e a pasta de conteúdo
 * (notas, anexos e projetos gerenciados). Projetos vinculados a pastas de fora ficam de fora: já são arquivos seus em
 * outro lugar. Links e junctions não são seguidos.
 */

export interface BackupDeps {
  db: DatabaseSync;
  userData: string;
  dataRoot: string;
  /** Pasta temporária (testes apontam para uma própria). */
  tmpDir?: string;
  now?: () => Date;
  appName: string;
  appVersion: string;
  /** Só os testes mudam isto, para exercitar o zip64 sem arquivos gigantes. */
  zipLimits?: ZipLimits;
}

/** Nome do arquivo sugerido: nexus-backup-20261123-1830.zip. */
export function suggestedBackupName(appName: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-backup-${stamp}.zip`;
}

/** Arquivos (caminho relativo com `/`) de uma pasta, sem seguir links. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), childRel);
      else if (e.isFile()) out.push(childRel);
    }
  };
  walk(dir, '');
  return out;
}

/** Tamanho (bytes) e quantidade de arquivos de uma pasta, sem seguir links. */
export function folderStats(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const rel of listFiles(dir)) {
    try {
      bytes += fs.statSync(path.join(dir, ...rel.split('/'))).size;
      files++;
    } catch {
      /* arquivo sumiu durante a contagem */
    }
  }
  return { bytes, files };
}

export class BackupService {
  constructor(private readonly deps: BackupDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  suggestedName(): string {
    return suggestedBackupName(this.deps.appName, this.now());
  }

  /** O que vai no zip, para a tela mostrar antes de salvar. */
  preview(): { bytes: number; files: number } {
    return folderStats(this.deps.dataRoot);
  }

  async export(target: string): Promise<BackupResult> {
    const { db, userData, dataRoot } = this.deps;
    if (!/\.zip$/i.test(target)) throw new NexusError('VALIDATION', 'Escolha um arquivo .zip.');
    if (!fs.existsSync(dataRoot)) throw new NexusError('NOT_FOUND', 'A pasta de conteúdo não foi encontrada.');
    const resolvedTarget = path.resolve(target);
    // O zip dentro da própria pasta de conteúdo entraria nele mesmo.
    const rel = path.relative(path.resolve(dataRoot), resolvedTarget);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      throw new NexusError('VALIDATION', 'Salve o backup fora da pasta de conteúdo do Nexus.');
    }

    const stage = fs.mkdtempSync(path.join(this.deps.tmpDir ?? os.tmpdir(), 'nexus-backup-'));
    const partial = `${resolvedTarget}.parcial`;
    let zip: ZipWriter | null = null;
    try {
      // Banco: cópia consistente (VACUUM INTO), mesmo com o app usando o banco.
      const dbCopy = path.join(stage, 'nexus.db');
      db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);

      zip = new ZipWriter(partial, this.deps.zipLimits);
      const when = this.now();
      let files = 0;
      await zip.addFile('nexus.db', dbCopy);
      files++;
      const prefs = path.join(userData, 'preferences.json');
      if (fs.existsSync(prefs)) {
        await zip.addFile('preferences.json', prefs);
        files++;
      }
      await zip.addText(
        'LEIA-ME.txt',
        [
          `Backup do ${this.deps.appName} ${this.deps.appVersion}, feito em ${when.toISOString()}.`,
          '',
          'nexus.db           banco do app (conversas, Workspaces, permissões)',
          'preferences.json   preferências',
          'conteudo/          pasta de conteúdo (notas, anexos, projetos gerenciados)',
          '',
          'Para restaurar: feche o Nexus, copie nexus.db e preferences.json para a pasta de dados do app',
          '(Configurações → Pastas → Dados do app) e o conteúdo de conteudo/ para a pasta de conteúdo.',
        ].join('\r\n'),
        when,
      );
      files++;
      for (const file of listFiles(dataRoot)) {
        // Arquivo que sumiu ou está travado fica de fora; o backup segue.
        if (await zip.addFile(`conteudo/${file}`, path.join(dataRoot, ...file.split('/')))) files++;
      }
      await zip.finish();
      zip = null;
      fs.renameSync(partial, resolvedTarget);
      return { path: resolvedTarget, bytes: fs.statSync(resolvedTarget).size, files };
    } catch (err) {
      if (err instanceof NexusError) throw err;
      throw new NexusError('INTERNAL', `Não foi possível criar o backup: ${(err as Error).message}`);
    } finally {
      zip?.abort();
      fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(partial, { force: true });
    }
  }
}
