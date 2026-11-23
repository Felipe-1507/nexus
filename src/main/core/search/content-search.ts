import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_MAX_HITS, type ContentHit, type ContentSearchResult } from '@shared/content-search';
import { excerpt, foldText, hasAll } from '../chat/search-text';

/**
 * Busca de texto nas notas e nos arquivos dos projetos. Lê os arquivos na hora (não há índice): cada pesquisa varre,
 * com limites de arquivos, de tamanho e de tempo para uma pasta de rede ou um repositório enorme não travar a tela.
 * Todas as palavras precisam aparecer (no nome ou no texto); maiúsculas e acentos não contam.
 */

/** Pastas que não valem a busca (dependências, saídas de build, a pasta interna do Nexus). */
export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'out',
  'build',
  'release',
  '.turbo',
  '.cache',
  '.nexus',
  '.venv',
  '__pycache__',
  'coverage',
]);
export const MAX_FILES = 8_000;
export const MAX_FILE_BYTES = 512 * 1024;
export const TIME_BUDGET_MS = 6_000;
const BINARY_PROBE = 8_000;
/** Cede a vez ao processo a cada tantos arquivos: a busca não prende a tela. */
const YIELD_EVERY = 40;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Trecho e linha da primeira palavra achada num texto (ou `null`). */
export function matchInText(
  text: string,
  terms: string[],
): { text: string; ranges: Array<[number, number]>; line: number } | null {
  if (!hasAll(foldText(text), terms)) return null;
  const found = excerpt(text, terms);
  if (!found) return null;
  // Linha da primeira ocorrência de qualquer palavra, contando no texto original sem acentos.
  const folded = foldText(text);
  const first = Math.min(...terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0));
  let line = 1;
  for (let i = 0; i < Math.min(first, text.length); i++) if (text.charCodeAt(i) === 10) line++;
  return { ...found, line };
}

export interface SearchBudget {
  files: number;
  deadline: number;
  stopped: boolean;
}

export function newBudget(now = Date.now()): SearchBudget {
  return { files: 0, deadline: now + TIME_BUDGET_MS, stopped: false };
}

/** Busca nas notas (título + texto). `notes` entrega uma nota por vez. */
export async function searchNotes(
  notes: AsyncIterable<{ path: string; title: string; text: string }>,
  terms: string[],
): Promise<ContentSearchResult> {
  const hits: ContentHit[] = [];
  let scanned = 0;
  let truncated = false;
  for await (const note of notes) {
    scanned++;
    if (scanned % YIELD_EVERY === 0) await tick();
    const body = matchInText(note.text, terms);
    const byTitle = hasAll(foldText(note.title), terms);
    // As palavras podem estar repartidas entre o título e o texto.
    const both = !body && !byTitle && hasAll(foldText(`${note.title}\n${note.text}`), terms);
    if (!body && !byTitle && !both) continue;
    if (hits.length >= CONTENT_MAX_HITS) {
      truncated = true;
      break;
    }
    const partial = both ? excerpt(note.text, terms) : null;
    hits.push({
      kind: 'note',
      path: note.path,
      name: note.title,
      projectId: null,
      projectName: null,
      line: body?.line ?? null,
      text: body?.text ?? partial?.text ?? '',
      ranges: body?.ranges ?? partial?.ranges ?? [],
    });
  }
  // Quem tem a palavra no título vem antes.
  hits.sort((a, b) => Number(hasAll(foldText(b.name), terms)) - Number(hasAll(foldText(a.name), terms)));
  return { hits, truncated, incomplete: false, scanned };
}

/** Busca nos arquivos de texto de uma pasta de projeto (nome e conteúdo). */
export async function searchFolder(
  root: string,
  terms: string[],
  project: { id: string; name: string },
  budget: SearchBudget,
  hits: ContentHit[],
): Promise<void> {
  const queue: string[] = [''];
  while (queue.length > 0 && !budget.stopped) {
    const rel = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    for (const e of entries) {
      if (budget.stopped) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(childRel);
        continue;
      }
      if (!e.isFile()) continue; // links e junctions não são seguidos
      if (budget.files >= MAX_FILES || Date.now() > budget.deadline) {
        budget.stopped = true;
        return;
      }
      budget.files++;
      if (budget.files % YIELD_EVERY === 0) await tick();
      if (hits.length >= CONTENT_MAX_HITS) {
        budget.stopped = true;
        return;
      }
      const byName = hasAll(foldText(e.name), terms);
      let found: ReturnType<typeof matchInText> = null;
      try {
        const file = path.join(root, childRel);
        const stat = await fs.stat(file);
        if (stat.size <= MAX_FILE_BYTES) {
          const buffer = await fs.readFile(file);
          if (!buffer.subarray(0, BINARY_PROBE).includes(0)) found = matchInText(buffer.toString('utf8'), terms);
        }
      } catch {
        /* arquivo sumiu ou sem permissão: segue */
      }
      if (!found && !byName) continue;
      hits.push({
        kind: 'file',
        path: childRel,
        name: e.name,
        projectId: project.id,
        projectName: project.name,
        line: found?.line ?? null,
        text: found?.text ?? '',
        ranges: found?.ranges ?? [],
      });
    }
  }
}

export async function searchProjects(
  projects: Array<{ id: string; name: string; path: string }>,
  terms: string[],
  now = Date.now(),
): Promise<ContentSearchResult> {
  const budget = newBudget(now);
  const hits: ContentHit[] = [];
  for (const project of projects) {
    if (budget.stopped) break;
    await searchFolder(project.path, terms, project, budget, hits);
  }
  const truncated = hits.length >= CONTENT_MAX_HITS;
  // Quem tem a palavra no nome vem antes (a ordem de varredura se mantém entre iguais).
  hits.sort((a, b) => Number(hasAll(foldText(b.name), terms)) - Number(hasAll(foldText(a.name), terms)));
  return { hits, truncated, incomplete: budget.stopped && !truncated, scanned: budget.files };
}
