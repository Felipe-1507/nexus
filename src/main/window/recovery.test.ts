import { describe, expect, it } from 'vitest';
import { createReloadBudget } from './recovery';

describe('limite de recarregamentos automáticos', () => {
  it('permite até o máximo dentro da janela de tempo e volta a permitir depois dela', () => {
    let t = 0;
    const budget = createReloadBudget(3, 60_000, () => t);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, true]);
    t = 30_000;
    expect(budget.take()).toBe(false);
    t = 60_001;
    expect(budget.take()).toBe(true);
  });
});
