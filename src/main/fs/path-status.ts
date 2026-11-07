import fs from 'node:fs/promises';
import type { PathStatus } from '@shared/project';

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Situação de uma pasta sem travar o processo: pastas de rede podem levar dezenas de segundos para responder
 * quando o servidor está fora do ar. Depois do tempo limite a pasta é dada como `unavailable`.
 */
export async function pathStatus(
  target: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: PathStatus; isDirectory: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([fs.stat(target).catch((err: NodeJS.ErrnoException) => err), timeout]);
    if (result === 'timeout') return { status: 'unavailable', isDirectory: false };
    if (result instanceof Error) {
      return {
        status: result.code === 'ENOENT' || result.code === 'ENOTDIR' ? 'missing' : 'unavailable',
        isDirectory: false,
      };
    }
    return { status: 'ok', isDirectory: result.isDirectory() };
  } finally {
    clearTimeout(timer);
  }
}
