/**
 * Move o item `id` para antes do item `beforeId` (ou para o fim, se `beforeId` for null).
 * Devolve a mesma lista quando nada muda, para quem chama poder pular a gravação.
 */
export function moveBefore(ids: string[], id: string, beforeId: string | null): string[] {
  if (id === beforeId || !ids.includes(id)) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  if (at === -1) return ids;
  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  return next.every((x, i) => x === ids[i]) ? ids : next;
}

/** Move o item uma posição para cima (-1) ou para baixo (+1), para o teclado. */
export function moveBy(ids: string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
