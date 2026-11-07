// Envelope de resposta do IPC. O Electron serializa mal exceções lançadas em handlers, então todo handler
// devolve sucesso ou erro explicitamente e o renderer reconstrói o erro.
export type IpcErrorCode =
  'INVALID_INPUT' | 'VALIDATION' | 'CONFLICT' | 'UNTRUSTED_SENDER' | 'UNKNOWN_CHANNEL' | 'NOT_FOUND' | 'INTERNAL';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export class NexusError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NexusError';
  }
}
