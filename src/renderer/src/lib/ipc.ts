import type { IpcChannel } from '@shared/ipc-channels';
import type { IpcInput, IpcOutput } from '@shared/ipc-contract';
import { NexusError } from '@shared/ipc-result';

/** Chamada tipada ao processo main. Lança `NexusError` quando o main devolve erro. */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcInput<C> extends undefined ? [] : [IpcInput<C>]
): Promise<IpcOutput<C>> {
  const result = await window.nexus.invoke(channel, args[0]);
  if (!result.ok) throw new NexusError(result.error.code, result.error.message);
  return result.data as IpcOutput<C>;
}
