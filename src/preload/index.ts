import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { isEventChannel, isIpcChannel } from '../shared/ipc-channels';
import type { NexusBridge } from './api';

const bridge: NexusBridge = {
  invoke(channel, input) {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Canal desconhecido: ${String(channel)}` },
      });
    }
    return ipcRenderer.invoke(channel, input);
  },
  on(channel, listener) {
    if (!isEventChannel(channel)) throw new Error(`Canal de eventos desconhecido: ${String(channel)}`);
    // Repassa só o conteúdo: o objeto do evento do Electron (com sender) nunca chega à tela.
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  // Caminho real de arquivos colados ou soltos na tela (o `File` do navegador não o expõe).
  pathsForFiles(files) {
    return files.map((file) => webUtils.getPathForFile(file)).filter((p) => p !== '');
  },
};

contextBridge.exposeInMainWorld('nexus', bridge);
