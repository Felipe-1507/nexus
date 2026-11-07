import type { EventChannel, IpcChannel } from '../shared/ipc-channels';
import type { IpcResult } from '../shared/ipc-result';

/** API exposta pelo preload em `window.nexus`. Mínima de propósito: invoke e escuta, ambos com lista fechada. */
export interface NexusBridge {
  invoke(channel: IpcChannel, input?: unknown): Promise<IpcResult<unknown>>;
  /** Escuta eventos do main. Devolve a função que cancela a escuta. */
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void;
  /** Caminhos no disco dos arquivos colados ou soltos na tela (vazio para o que não veio do disco). */
  pathsForFiles(files: File[]): string[];
}

declare global {
  interface Window {
    nexus: NexusBridge;
  }
}
