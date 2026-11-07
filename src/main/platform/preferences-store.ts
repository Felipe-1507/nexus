import { preferencesSchema, savePreferences, type Preferences } from './preferences';

type Listener = (preferences: Preferences, previous: Preferences) => void;

/** Fonte da verdade das preferências em memória. Cada alteração é gravada em disco e notificada. */
export class PreferencesStore {
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly file: string,
    private current: Preferences,
  ) {}

  get(): Preferences {
    return this.current;
  }

  update(patch: Partial<Preferences>): Preferences {
    const previous = this.current;
    const next = preferencesSchema.parse({ ...previous, ...patch });
    savePreferences(this.file, next);
    this.current = next;
    for (const listener of this.listeners) listener(next, previous);
    return next;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
