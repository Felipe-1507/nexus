import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  updateManifestSchema,
  UPDATE_MANIFEST_NAME,
  type AppUpdateStatus,
  type UpdateManifest,
} from '@shared/app-update';
import { NexusError } from '@shared/ipc-result';
import { compareVersions } from './cli-detector';

const MANIFEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** A consulta é refeita no máximo a cada 4 horas, a menos que o usuário peça. */
const TTL_MS = 4 * 60 * 60_000;
const MANIFEST_MAX_BYTES = 16 * 1024;

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface AppUpdateDeps {
  /** Pasta/endereço configurado (`null` = desligado). */
  source: () => string | null;
  currentVersion: string;
  /** Onde o instalador baixado fica guardado até rodar. */
  downloadDir: string;
  fetch: FetchLike;
  /** Inicia o instalador e deixa-o seguir sozinho depois que o Nexus fechar. */
  launch: (file: string, args: string[]) => void;
  /** Fecha o Nexus para o instalador poder trocar os arquivos. */
  quit: () => void;
  now?: () => number;
}

const isUrl = (source: string) => /^https?:\/\//i.test(source);

/** Endereço aceito: HTTPS, ou HTTP só para o próprio computador (testes). */
export function checkSource(source: string): { kind: 'url'; base: string } | { kind: 'folder'; dir: string } {
  if (isUrl(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new NexusError('VALIDATION', 'Endereço de atualização inválido.');
    }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) {
      throw new NexusError('VALIDATION', 'Use um endereço HTTPS para as atualizações.');
    }
    return { kind: 'url', base: source.endsWith('/') ? source : `${source}/` };
  }
  return { kind: 'folder', dir: source };
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NexusError('VALIDATION', message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class AppUpdateService {
  private cache: { at: number; status: AppUpdateStatus; manifest: UpdateManifest | null; source: string } | null = null;

  constructor(private readonly deps: AppUpdateDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private base(extra: Partial<AppUpdateStatus>): AppUpdateStatus {
    return {
      configured: true,
      current: this.deps.currentVersion,
      latest: null,
      available: false,
      error: null,
      checkedAt: new Date(this.now()).toISOString(),
      ...extra,
    };
  }

  private async readManifest(source: string): Promise<UpdateManifest> {
    const where = checkSource(source);
    let text: string;
    if (where.kind === 'folder') {
      const file = path.join(where.dir, UPDATE_MANIFEST_NAME);
      text = await withTimeout(
        fs.promises.readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
          throw new NexusError(
            'NOT_FOUND',
            err.code === 'ENOENT'
              ? `Não há ${UPDATE_MANIFEST_NAME} nessa pasta.`
              : `Não foi possível ler a pasta de atualizações: ${err.message}`,
          );
        }),
        MANIFEST_TIMEOUT_MS,
        'A pasta de atualizações não respondeu (rede?).',
      );
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
      try {
        const res = await this.deps
          .fetch(new URL(UPDATE_MANIFEST_NAME, where.base).toString(), { signal: controller.signal })
          .catch(() => {
            throw new NexusError('VALIDATION', 'O endereço de atualizações não respondeu.');
          });
        if (!res.ok) throw new NexusError('VALIDATION', `O endereço de atualizações respondeu ${res.status}.`);
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }
    }
    if (text.length > MANIFEST_MAX_BYTES) throw new NexusError('VALIDATION', 'Manifesto de atualização grande demais.');
    let json: unknown;
    try {
      json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      throw new NexusError('VALIDATION', `${UPDATE_MANIFEST_NAME} não é um JSON válido.`);
    }
    const parsed = updateManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new NexusError('VALIDATION', `${UPDATE_MANIFEST_NAME} inválido: ${parsed.error.issues[0]?.message}.`);
    }
    return parsed.data;
  }

  /** Consulta o lugar configurado. Falha de consulta vira `error` no status (nunca atrapalha o app). */
  async check(refresh = false): Promise<AppUpdateStatus> {
    const source = this.deps.source();
    if (!source) {
      this.cache = null;
      return {
        configured: false,
        current: this.deps.currentVersion,
        latest: null,
        available: false,
        error: null,
        checkedAt: null,
      };
    }
    const now = this.now();
    if (!refresh && this.cache && this.cache.source === source && now - this.cache.at < TTL_MS)
      return this.cache.status;
    try {
      const manifest = await this.readManifest(source);
      const status = this.base({
        latest: manifest.version,
        available: compareVersions(manifest.version, this.deps.currentVersion) > 0,
      });
      this.cache = { at: now, status, manifest, source };
      return status;
    } catch (err) {
      const status = this.base({ error: err instanceof Error ? err.message : String(err) });
      // Falha: tenta de novo em 10 minutos, sem guardar como resposta boa.
      this.cache = { at: now - TTL_MS + 10 * 60_000, status, manifest: null, source };
      return status;
    }
  }

  /** Traz o instalador, confere o SHA-512, inicia a instalação silenciosa e fecha o Nexus. */
  async install(): Promise<null> {
    const status = await this.check(true);
    const source = this.deps.source();
    const manifest = this.cache?.manifest;
    if (!source || !manifest || status.error) {
      throw new NexusError('VALIDATION', status.error ?? 'Atualização não configurada.');
    }
    if (!status.available) throw new NexusError('VALIDATION', 'Você já está na versão mais nova.');

    fs.mkdirSync(this.deps.downloadDir, { recursive: true });
    for (const old of fs.readdirSync(this.deps.downloadDir))
      fs.rmSync(path.join(this.deps.downloadDir, old), { force: true });
    const target = path.join(this.deps.downloadDir, manifest.file);
    const partial = `${target}.parcial`;
    try {
      const where = checkSource(source);
      const hash = createHash('sha512');
      const out = fs.createWriteStream(partial);
      if (where.kind === 'folder') {
        const input = fs.createReadStream(path.join(where.dir, manifest.file));
        input.on('data', (chunk) => hash.update(chunk));
        await withTimeout(pipeline(input, out), DOWNLOAD_TIMEOUT_MS, 'A cópia do instalador demorou demais.');
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        try {
          const res = await this.deps.fetch(new URL(manifest.file, where.base).toString(), {
            signal: controller.signal,
          });
          if (!res.ok || !res.body)
            throw new NexusError('VALIDATION', `Não foi possível baixar o instalador (${res.status}).`);
          const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
          body.on('data', (chunk) => hash.update(chunk));
          await pipeline(body, out);
        } finally {
          clearTimeout(timer);
        }
      }
      if (hash.digest('hex').toLowerCase() !== manifest.sha512.toLowerCase()) {
        throw new NexusError(
          'VALIDATION',
          'O instalador não confere com o SHA-512 do manifesto (arquivo incompleto ou alterado). Nada foi instalado.',
        );
      }
      fs.renameSync(partial, target);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      if (err instanceof NexusError) throw err;
      throw new NexusError('INTERNAL', `Não foi possível trazer o instalador: ${(err as Error).message}`);
    }
    // `/S` instala em silêncio; `--updated` faz o instalador esperar o Nexus fechar; `--force-run` o reabre no fim.
    this.deps.launch(target, ['/S', '--updated', '--force-run']);
    this.deps.quit();
    return null;
  }
}
