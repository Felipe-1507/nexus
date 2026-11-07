import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { NexusError } from '@shared/ipc-result';
import { GLOBAL_INSTRUCTIONS_MAX } from '@shared/project';
import { SettingsRepo } from '../../persistence/repositories/settings-repo';

const KEY = 'global.instructions';

/** Instruções gerais do usuário: a primeira camada do contexto, válida em todos os Workspaces. */
export class GlobalInstructions {
  private readonly settings: SettingsRepo;

  constructor(db: DatabaseSync) {
    this.settings = new SettingsRepo(db);
  }

  get(): string {
    return this.settings.get(KEY, z.string()) ?? '';
  }

  set(text: string): string {
    if (Buffer.byteLength(text, 'utf8') > GLOBAL_INSTRUCTIONS_MAX) {
      throw new NexusError('VALIDATION', `As instruções passam do limite de ${GLOBAL_INSTRUCTIONS_MAX / 1024} KB.`);
    }
    this.settings.set(KEY, text);
    return text;
  }
}
