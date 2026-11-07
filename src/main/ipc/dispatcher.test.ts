import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { AppInfo } from '@shared/ipc-contract';
import { NexusError } from '@shared/ipc-result';
import { createDispatcher, type IpcHandlers } from './dispatcher';

/** Canais que o teste não exercita respondem com erro, para não precisar listar cada um. */
const unused = Object.fromEntries(
  IPC_CHANNELS.map((c) => [
    c,
    () => {
      throw new Error(`canal ${c} não usado neste teste`);
    },
  ]),
) as unknown as IpcHandlers;

const info: AppInfo = {
  appVersion: '0.1.0',
  versions: { electron: '45', node: '24', chrome: '140' },
  platform: 'win32',
  paths: { userData: 'u', dataRoot: 'd', database: 'db', logs: 'l' },
  database: { schemaVersion: 1, sqliteVersion: '3.53' },
};

function setup(getInfo: IpcHandlers['app:getInfo'] = () => info) {
  const onError = vi.fn();
  const dispatch = createDispatcher(
    {
      ...unused,
      'app:getInfo': getInfo,
      'app:openPath': () => null,
      'preferences:get': () => ({ theme: 'system' }),
      'preferences:setTheme': (theme) => ({ theme }),
    },
    { isTrustedSender: (url) => url?.startsWith('nexus://app/') ?? false, onError },
  );
  return { dispatch, onError };
}

const TRUSTED = 'nexus://app/index.html';

describe('dispatcher IPC', () => {
  it('executa o handler e devolve o envelope de sucesso', async () => {
    const { dispatch } = setup();
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toEqual({ ok: true, data: info });
  });

  it('rejeita canal fora da lista', async () => {
    const { dispatch } = setup();
    expect(await dispatch('fs:apagarTudo', TRUSTED, undefined)).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_CHANNEL' },
    });
  });

  it('rejeita origem não confiável antes de executar', async () => {
    const handler = vi.fn(() => info);
    const { dispatch } = setup(handler);
    expect(await dispatch('app:getInfo', 'https://example.com/', undefined)).toMatchObject({
      ok: false,
      error: { code: 'UNTRUSTED_SENDER' },
    });
    expect(await dispatch('app:getInfo', undefined, undefined)).toMatchObject({ ok: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('valida entradas com enum: aceita tema válido e recusa o resto', async () => {
    const { dispatch } = setup();
    expect(await dispatch('preferences:setTheme', TRUSTED, 'dark')).toEqual({ ok: true, data: { theme: 'dark' } });
    expect(await dispatch('preferences:setTheme', TRUSTED, 'roxo')).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(await dispatch('app:openPath', TRUSTED, 'C:\\Windows')).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('devolve a mensagem de validação legível do schema', async () => {
    const { dispatch } = setup();
    const r = await dispatch('workspaces:create', TRUSTED, { name: '   ', color: 'violet', icon: 'layers' });
    expect(r).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Dê um nome ao Workspace' } });
  });

  it('rejeita entrada que não segue o contrato', async () => {
    const { dispatch } = setup();
    expect(await dispatch('app:getInfo', TRUSTED, { inesperado: true })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('não vaza detalhes de erros internos e registra no log', async () => {
    const { dispatch, onError } = setup(() => {
      throw new Error('C:\\segredo\\caminho interno');
    });
    const r = await dispatch('app:getInfo', TRUSTED, undefined);
    expect(r).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Erro interno. Detalhes no log.' } });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('repassa erros de domínio com o código', async () => {
    const { dispatch } = setup(() => {
      throw new NexusError('NOT_FOUND', 'Workspace não encontrado');
    });
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Workspace não encontrado' },
    });
  });

  it('rejeita saída do handler que viola o contrato', async () => {
    const { dispatch, onError } = setup(() => ({ ...info, appVersion: 1 }) as unknown as AppInfo);
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(onError).toHaveBeenCalledOnce();
  });
});
