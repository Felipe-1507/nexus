import fs from 'node:fs';
import path from 'node:path';
import { planetStylesSchema, type PlanetStyles } from '@shared/knowledge';
import type { PlanetOverride } from '@shared/planets';
import { writeFileAtomic } from '../../fs/atomic';

/** Arquivo oculto do vault (o `Vault` e o watcher ignoram o que começa com ponto): viaja junto com as notas. */
export const PLANET_STYLES_FILE = '.planetas.json';

/**
 * Aparência que o usuário escolheu para cada planeta da galáxia, por caminho de nota. Só guarda o que foi trocado; o
 * resto continua sorteado. Mover ou renomear uma nota faz o planeta dela voltar ao sorteio.
 */
export class PlanetStyleStore {
  constructor(private readonly dirFor: (workspaceId: string) => string) {}

  private file(workspaceId: string): string {
    return path.join(this.dirFor(workspaceId), PLANET_STYLES_FILE);
  }

  get(workspaceId: string): PlanetStyles {
    try {
      const parsed = planetStylesSchema.safeParse(JSON.parse(fs.readFileSync(this.file(workspaceId), 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      // Sem arquivo ainda, ou arquivo estragado: todos os planetas ficam no sorteio.
      return {};
    }
  }

  /** Grava a aparência de um planeta (`null` ou vazio = volta ao sorteio) e devolve todas as escolhas. */
  set(workspaceId: string, notePath: string, override: PlanetOverride | null): PlanetStyles {
    const styles = this.get(workspaceId);
    const clean = override && Object.keys(override).length > 0 ? override : null;
    if (clean) styles[notePath] = clean;
    else delete styles[notePath];
    fs.mkdirSync(this.dirFor(workspaceId), { recursive: true });
    writeFileAtomic(this.file(workspaceId), JSON.stringify(styles, null, 2));
    return styles;
  }
}
