import fs from 'node:fs';
import { once } from 'node:events';
import zlib from 'node:zlib';

/**
 * Gravador de .zip em streaming (sem biblioteca): cada arquivo é lido, comprimido (deflate) e gravado sem ser
 * carregado inteiro na memória. Nomes em UTF-8; arquivos e totais acima dos limites do zip clássico usam zip64.
 * O tamanho e o CRC vão num "data descriptor" depois dos dados, então o arquivo pode mudar durante a leitura.
 */

const U32 = 0xffffffff;
const U16 = 0xffff;
const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const FLAGS = 0x0008 | 0x0800; // data descriptor + nomes em UTF-8

export interface ZipLimits {
  /** Arquivo com tamanho a partir daqui usa zip64 (o limite clássico é 4 GB). */
  zip64Entry: number;
  /** Mais entradas que isto pedem o registro final em zip64 (o limite clássico é 65.535). */
  zip64Count: number;
}
const DEFAULT_LIMITS: ZipLimits = { zip64Entry: 0xf0000000, zip64Count: U16 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Entry {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  zip64: boolean;
  time: number;
  date: number;
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private offset = 0;
  private readonly out: fs.WriteStream;
  private failure: Error | null = null;

  constructor(
    file: string,
    private readonly limits: ZipLimits = DEFAULT_LIMITS,
  ) {
    this.out = fs.createWriteStream(file);
    this.out.on('error', (err) => {
      this.failure = err;
    });
  }

  private async write(chunk: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    this.offset += chunk.length;
    if (!this.out.write(chunk)) await once(this.out, 'drain');
    if (this.failure) throw this.failure;
  }

  /**
   * Acrescenta um arquivo do disco (`name` usa `/` e não começa com `/`). Devolve `false`, sem gravar nada, se o
   * arquivo não pôde ser aberto (sumiu, está travado ou sem permissão); erros no meio da leitura são lançados.
   */
  async addFile(name: string, file: string): Promise<boolean> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, 'r');
    } catch (err) {
      if (['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes((err as NodeJS.ErrnoException).code ?? '')) return false;
      throw err;
    }
    try {
      const stat = await handle.stat();
      await this.add(name, stat.mtime, stat.size, () => handle.createReadStream({ autoClose: false }));
      return true;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async addText(name: string, text: string, when = new Date()): Promise<void> {
    const data = Buffer.from(text, 'utf8');
    await this.add(name, when, data.length, async function* () {
      yield data;
    });
  }

  private async add(
    name: string,
    when: Date,
    expectedSize: number,
    source: () => AsyncIterable<Buffer | string>,
  ): Promise<void> {
    const nameBytes = Buffer.from(name, 'utf8');
    const zip64 = expectedSize >= this.limits.zip64Entry;
    const { time, date } = dosDateTime(when);
    const offset = this.offset;

    const local = Buffer.alloc(30 + nameBytes.length + (zip64 ? 20 : 0));
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // CRC e tamanhos ficam zerados: vêm no data descriptor (em zip64, os campos valem 0xFFFFFFFF + extra).
    if (zip64) {
      local.writeUInt32LE(U32, 18);
      local.writeUInt32LE(U32, 22);
    }
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(zip64 ? 20 : 0, 28);
    nameBytes.copy(local, 30);
    if (zip64) {
      const at = 30 + nameBytes.length;
      local.writeUInt16LE(0x0001, at);
      local.writeUInt16LE(16, at + 2);
    }
    await this.write(local);

    const deflate = zlib.createDeflateRaw({ level: 6 });
    let crc = 0;
    let size = 0;
    let compressed = 0;
    const pump = (async () => {
      for await (const chunk of source()) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        crc = crc32(buf, crc);
        size += buf.length;
        if (!deflate.write(buf)) await once(deflate, 'drain');
      }
      deflate.end();
    })();
    pump.catch((err: unknown) => deflate.destroy(err as Error));
    for await (const chunk of deflate) {
      compressed += (chunk as Buffer).length;
      await this.write(chunk as Buffer);
    }
    await pump;

    const descriptor = Buffer.alloc(zip64 ? 24 : 16);
    descriptor.writeUInt32LE(SIG_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc, 4);
    if (zip64) {
      descriptor.writeBigUInt64LE(BigInt(compressed), 8);
      descriptor.writeBigUInt64LE(BigInt(size), 16);
    } else {
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    await this.write(descriptor);
    this.entries.push({ name: nameBytes, crc, compressed, size, offset, zip64, time, date });
  }

  /** Grava o índice final e fecha o arquivo. */
  async finish(): Promise<void> {
    const centralStart = this.offset;
    for (const e of this.entries) {
      const bigOffset = e.offset >= U32;
      const extra: number[] = [];
      if (e.zip64 || bigOffset) {
        // Só entram no extra os campos que valem 0xFFFFFFFF no registro principal.
        if (e.zip64) extra.push(e.size, e.compressed);
        if (bigOffset) extra.push(e.offset);
      }
      const extraBytes = extra.length > 0 ? Buffer.alloc(4 + extra.length * 8) : Buffer.alloc(0);
      if (extra.length > 0) {
        extraBytes.writeUInt16LE(0x0001, 0);
        extraBytes.writeUInt16LE(extra.length * 8, 2);
        extra.forEach((v, i) => extraBytes.writeBigUInt64LE(BigInt(v), 4 + i * 8));
      }
      const header = Buffer.alloc(46 + e.name.length + extraBytes.length);
      header.writeUInt32LE(SIG_CENTRAL, 0);
      header.writeUInt16LE(extra.length > 0 ? 45 : 20, 4); // criado por
      header.writeUInt16LE(extra.length > 0 ? 45 : 20, 6); // necessário para extrair
      header.writeUInt16LE(FLAGS, 8);
      header.writeUInt16LE(8, 10);
      header.writeUInt16LE(e.time, 12);
      header.writeUInt16LE(e.date, 14);
      header.writeUInt32LE(e.crc, 16);
      header.writeUInt32LE(e.zip64 ? U32 : e.compressed, 20);
      header.writeUInt32LE(e.zip64 ? U32 : e.size, 24);
      header.writeUInt16LE(e.name.length, 28);
      header.writeUInt16LE(extraBytes.length, 30);
      header.writeUInt32LE(bigOffset ? U32 : e.offset, 42);
      e.name.copy(header, 46);
      extraBytes.copy(header, 46 + e.name.length);
      await this.write(header);
    }
    const centralSize = this.offset - centralStart;
    const count = this.entries.length;
    const needs64 = count >= this.limits.zip64Count || centralStart >= U32 || centralSize >= U32;
    if (needs64) {
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(SIG_EOCD64, 0);
      rec.writeBigUInt64LE(44n, 4);
      rec.writeUInt16LE(45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(count), 24);
      rec.writeBigUInt64LE(BigInt(count), 32);
      rec.writeBigUInt64LE(BigInt(centralSize), 40);
      rec.writeBigUInt64LE(BigInt(centralStart), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(SIG_LOCATOR64, 0);
      locator.writeBigUInt64LE(BigInt(this.offset), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(rec);
      await this.write(locator);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(needs64 ? U16 : count, 8);
    eocd.writeUInt16LE(needs64 ? U16 : count, 10);
    eocd.writeUInt32LE(needs64 ? U32 : centralSize, 12);
    eocd.writeUInt32LE(needs64 ? U32 : centralStart, 16);
    await this.write(eocd);
    this.out.end();
    await once(this.out, 'finish');
    if (this.failure) throw this.failure;
  }

  /** Para tudo (erro no meio do caminho): fecha o arquivo sem gravar o índice. */
  abort(): void {
    this.out.destroy();
  }
}
