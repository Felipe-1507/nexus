/**
 * Movimento ambiente da galáxia: o giro automático e, nas próximas etapas, naves, cometas e pulsos. Tudo passa por
 * aqui para respeitar o perfil de qualidade, o foco da janela e a preferência de movimento reduzido. Sem nada animando,
 * a cena continua desenhando só quando algo muda (Etapa 15.9).
 */

/** Algo que se anima sozinho. `update` devolve `false` quando terminou (e sai da lista). */
export interface Animator {
  update(dtSeconds: number, now: number): boolean;
  /** Movimento rápido no momento (ex.: estrela cadente passando): pede o ritmo cheio do perfil, não o lento. */
  readonly fast?: boolean;
}

export interface AmbientState {
  /** Quadros por segundo com a janela em foco e sem foco (0 = parado). */
  fps: number;
  unfocusedFps: number;
  focused: boolean;
  reducedMotion: boolean;
}

/** Intervalo entre quadros do movimento ambiente, em ms, ou `null` quando ele deve ficar parado. */
export function ambientInterval(state: AmbientState): number | null {
  if (state.reducedMotion) return null;
  const fps = state.focused ? state.fps : state.unfocusedFps;
  return fps > 0 ? 1000 / fps : null;
}

/** Decide se um quadro dirigido só pelo movimento ambiente deve ser desenhado agora. */
export function ambientFrameDue(now: number, lastFrame: number, interval: number | null): boolean {
  // Uma folga de 1 ms evita perder quadros por arredondamento do relógio (30 fps num monitor de 60 Hz).
  return interval !== null && now - lastFrame >= interval - 1;
}

export class AmbientClock {
  private readonly animators = new Set<Animator>();

  /** Registra uma animação; devolve a função que a remove. */
  add(animator: Animator): () => void {
    this.animators.add(animator);
    return () => this.animators.delete(animator);
  }

  get size(): number {
    return this.animators.size;
  }

  /** Alguma animação rápida em andamento. */
  get fast(): boolean {
    for (const a of this.animators) if (a.fast) return true;
    return false;
  }

  /** Avança todas as animações; as que terminaram saem. */
  tick(dtSeconds: number, now: number): void {
    for (const a of [...this.animators]) if (!a.update(dtSeconds, now)) this.animators.delete(a);
  }

  clear(): void {
    this.animators.clear();
  }
}
