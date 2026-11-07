import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { Dispatch } from './dispatcher';

export function registerIpc(dispatch: Dispatch): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, (event, input: unknown) => dispatch(channel, event.senderFrame?.url, input));
  }
}
