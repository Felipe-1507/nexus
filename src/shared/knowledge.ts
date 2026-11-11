import { z } from 'zod';
import { planetOverrideSchema } from './planets';

export type NoteTreeNode = {
  type: 'folder' | 'note';
  /** Nome sem `.md`. */
  name: string;
  /** Caminho relativo ao vault, com `/`. A raiz é ''. */
  path: string;
  children?: NoteTreeNode[];
};

export const noteTreeNodeSchema: z.ZodType<NoteTreeNode> = z.lazy(() =>
  z.object({
    type: z.enum(['folder', 'note']),
    name: z.string(),
    path: z.string(),
    children: z.array(noteTreeNodeSchema).optional(),
  }),
);

/** Caminho relativo dentro do vault (validado de novo no main contra `..`, links e junctions). */
export const notePathSchema = z.string().max(500);

export const noteSchema = z.object({
  path: z.string(),
  content: z.string(),
  mtimeMs: z.number(),
});
export type Note = z.infer<typeof noteSchema>;

export const noteLinksSchema = z.object({
  /** Links desta nota: `path` null = nota ainda não existe. */
  outgoing: z.array(z.object({ target: z.string(), path: z.string().nullable() })),
  /** Notas que citam esta. */
  backlinks: z.array(z.object({ path: z.string(), title: z.string() })),
});
export type NoteLinks = z.infer<typeof noteLinksSchema>;

/** Evento do main quando arquivos do vault mudam (pelo Nexus, pelo Claude ou por outro programa). */
export interface KnowledgeEvent {
  workspaceId: string;
  /** Caminhos relativos alterados (vazio = recarregar tudo). */
  paths: string[];
}

export const KNOWLEDGE_EVENT_CHANNEL = 'knowledge:event';

/** Grafo do vault para a galáxia: notas (planetas) e links resolvidos entre elas (rotas, sem direção). */
export const galaxyGraphSchema = z.object({
  notes: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      /** Pasta de primeiro nível (sistema solar). '' = notas soltas na raiz do vault (núcleo). */
      system: z.string(),
      tags: z.array(z.string()),
      mtimeMs: z.number(),
      /** Tamanho da nota em caracteres (o planeta cresce com o conteúdo). */
      chars: z.number().int().nonnegative(),
      /** Número de rotas (links de e para outras notas). */
      degree: z.number().int(),
      /** Blocos de código, imagens e outros anexos incorporados (aparência automática do planeta). */
      codeBlocks: z.number().int().nonnegative().optional(),
      images: z.number().int().nonnegative().optional(),
      attachments: z.number().int().nonnegative().optional(),
    }),
  ),
  /** Pares de índices em `notes`, sem repetição e sem link para a própria nota. */
  links: z.array(z.tuple([z.number().int(), z.number().int()])),
  /** Sentido de cada rota, na ordem de `links`: 1 = do primeiro para o segundo, 2 = o contrário, 3 = os dois. */
  directions: z.array(z.number().int().min(1).max(3)).optional(),
});
export type GalaxyGraph = z.infer<typeof galaxyGraphSchema>;

/** Aparência escolhida pelo usuário para cada planeta (só o que ele trocou), por caminho de nota. */
export const planetStylesSchema = z.record(z.string(), planetOverrideSchema);
export type PlanetStyles = z.infer<typeof planetStylesSchema>;
