import { isIpcChannel, type IpcChannel } from '@shared/ipc-channels';
import { ipcContract, type IpcInput, type IpcOutput } from '@shared/ipc-contract';
import { NexusError, type IpcResult } from '@shared/ipc-result';

export type IpcHandlers = { [C in IpcChannel]: (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>> };

export interface DispatcherOptions {
  isTrustedSender: (senderUrl: string | undefined) => boolean;
  onError: (channel: string, error: unknown) => void;
}

export type Dispatch = (channel: unknown, senderUrl: string | undefined, input: unknown) => Promise<IpcResult<unknown>>;

/**
 * Ponto único por onde passa toda chamada do renderer: confere a origem, valida a entrada com o contrato,
 * executa o handler, valida a saída e devolve um envelope. Não depende do Electron, então é testável.
 */
export function createDispatcher(handlers: IpcHandlers, options: DispatcherOptions): Dispatch {
  return async (channel, senderUrl, input) => {
    if (!isIpcChannel(channel)) {
      return { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: `Canal desconhecido: ${String(channel)}` } };
    }
    if (!options.isTrustedSender(senderUrl)) {
      return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'Origem não autorizada' } };
    }
    const contract = ipcContract[channel];
    const parsed = contract.input.safeParse(input);
    if (!parsed.success) {
      // A primeira mensagem do schema já é legível ("Dê um nome ao Workspace") e pode ir direto para a tela.
      const message = parsed.error.issues[0]?.message ?? 'Dados inválidos';
      return { ok: false, error: { code: 'INVALID_INPUT', message } };
    }
    try {
      const handler = handlers[channel] as (input: unknown) => unknown;
      const output = contract.output.parse(await handler(parsed.data));
      return { ok: true, data: output };
    } catch (err) {
      if (err instanceof NexusError) return { ok: false, error: { code: err.code, message: err.message } };
      options.onError(channel, err);
      return { ok: false, error: { code: 'INTERNAL', message: 'Erro interno. Detalhes no log.' } };
    }
  };
}
