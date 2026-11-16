import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trays: FakeTray[] = [];
let failTray = false;

class FakeTray extends EventEmitter {
  destroyed = false;
  menu: Array<{ label?: string; click?: () => void }> = [];
  balloons: unknown[] = [];
  constructor(public icon: unknown) {
    super();
    if (failTray) throw new Error('sem bandeja');
    trays.push(this);
  }
  setToolTip = vi.fn();
  setContextMenu(menu: unknown) {
    this.menu = menu as FakeTray['menu'];
  }
  displayBalloon(options: unknown) {
    this.balloons.push(options);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}

vi.mock('electron', () => ({
  Tray: FakeTray,
  Menu: { buildFromTemplate: (template: unknown) => template },
  nativeImage: { createFromPath: () => ({ resize: () => 'icone' }) },
}));

const { createBackgroundMode, quitConfirmation } = await import('./background');

class FakeWindow extends EventEmitter {
  hidden = false;
  hide() {
    this.hidden = true;
  }
}

function setup(over: { running?: number; answer?: number } = {}) {
  const confirm = vi.fn(async () => ({ response: over.answer ?? 0 }));
  const quit = vi.fn();
  const showWindow = vi.fn();
  const mode = createBackgroundMode({
    iconPath: 'icon.png',
    productName: 'Nexus',
    runningCount: () => over.running ?? 0,
    confirm,
    quit,
    showWindow,
  });
  const win = new FakeWindow();
  mode.attach(win as never);
  const close = () => {
    let prevented = false;
    win.emit('close', { preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { mode, win, confirm, quit, showWindow, close };
}

beforeEach(() => {
  trays.length = 0;
});

describe('segundo plano', () => {
  it('fechar a janela só a esconde, mantém o ícone e avisa uma vez', () => {
    const { win, close, mode } = setup();
    expect(close()).toBe(true);
    expect(win.hidden).toBe(true);
    expect(mode.isHidden()).toBe(true);
    expect(trays).toHaveLength(1);
    expect(trays[0]!.balloons).toHaveLength(1);
    close();
    expect(trays[0]!.balloons).toHaveLength(1);
    win.emit('show');
    expect(mode.isHidden()).toBe(false);
  });

  it('o ícone abre a janela (clique e duplo clique) e o menu tem abrir e fechar', () => {
    const { showWindow } = setup();
    const tray = trays[0]!;
    tray.emit('click');
    tray.emit('double-click');
    expect(showWindow).toHaveBeenCalledTimes(2);
    expect(tray.menu.map((m) => m.label)).toEqual(['Abrir o Nexus', undefined, 'Fechar o Nexus…']);
    tray.menu[0]!.click!();
    expect(showWindow).toHaveBeenCalledTimes(3);
  });

  it('fechar de vez pede confirmação: recusar mantém tudo, aceitar encerra e deixa a janela fechar', async () => {
    const no = setup({ answer: 1, running: 2 });
    expect(await no.mode.requestQuit()).toBe(false);
    expect(no.quit).not.toHaveBeenCalled();
    expect(no.close()).toBe(true);
    expect(no.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('2 respostas') }),
    );

    const yes = setup({ answer: 0 });
    expect(await yes.mode.requestQuit()).toBe(true);
    expect(yes.quit).toHaveBeenCalledOnce();
    expect(yes.close()).toBe(false);
  });

  it('o app encerrando (menu, atualização) e o desligamento do Windows não são impedidos', () => {
    const a = setup();
    a.mode.markQuitting();
    expect(a.close()).toBe(false);
    const b = setup();
    b.win.emit('session-end');
    expect(b.close()).toBe(false);
  });

  it('duas perguntas ao mesmo tempo viram uma só', async () => {
    const { mode, confirm } = setup({ answer: 1 });
    const [a, b] = await Promise.all([mode.requestQuit(), mode.requestQuit()]);
    expect([a, b]).toEqual([false, false]);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('texto da pergunta conforme as respostas em andamento', () => {
    const detail = (n: number) => quitConfirmation('Nexus', n).detail;
    expect(detail(0)).toContain('Nenhuma resposta');
    expect(detail(1)).toContain('1 resposta do Claude em andamento: ela será interrompida');
    expect(detail(3)).toContain('3 respostas');
    expect(quitConfirmation('Nexus', 0)).toMatchObject({ defaultId: 1, cancelId: 1 });
  });

  it('sem como criar o ícone, a janela fecha normalmente (o app não fica escondido sem saída)', () => {
    failTray = true;
    try {
      const { close, win } = setup();
      expect(close()).toBe(false);
      expect(win.hidden).toBe(false);
    } finally {
      failTray = false;
    }
  });
});
