import { describe, expect, it } from 'vitest';
import { moveBefore, moveBy } from './order';

describe('ordem dos projetos', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('move um item para antes de outro', () => {
    expect(moveBefore(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBefore(ids, 'a', 'd')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('move para o fim quando não há item de referência', () => {
    expect(moveBefore(ids, 'a', null)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('devolve a mesma lista quando nada muda', () => {
    expect(moveBefore(ids, 'b', 'b')).toBe(ids);
    expect(moveBefore(ids, 'b', 'c')).toBe(ids);
    expect(moveBefore(ids, 'd', null)).toBe(ids);
    expect(moveBefore(ids, 'x', 'a')).toBe(ids);
    expect(moveBefore(ids, 'a', 'x')).toBe(ids);
  });

  it('move uma posição pelo teclado e para nos extremos', () => {
    expect(moveBy(ids, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveBy(ids, 'c', 1)).toEqual(['a', 'b', 'd', 'c']);
    expect(moveBy(ids, 'a', -1)).toBe(ids);
    expect(moveBy(ids, 'd', 1)).toBe(ids);
  });
});
