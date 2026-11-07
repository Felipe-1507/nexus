import { describe, expect, it } from 'vitest';
import { formatFullTime, formatMessageTime } from './format-time';

const at = (y: number, m: number, d: number, h: number, min: number, s = 0) =>
  new Date(y, m - 1, d, h, min, s).toISOString();
const now = new Date(2026, 10, 7, 15, 0); // 7 de novembro de 2026, 15:00 (hora local)

describe('horário das mensagens', () => {
  it('no mesmo dia mostra só a hora, com zero à esquerda', () => {
    expect(formatMessageTime(at(2026, 11, 7, 14, 32), now)).toBe('14:32');
    expect(formatMessageTime(at(2026, 11, 7, 9, 5), now)).toBe('09:05');
    expect(formatMessageTime(at(2026, 11, 7, 0, 0), now)).toBe('00:00');
  });

  it('ontem, no ano e em outro ano', () => {
    expect(formatMessageTime(at(2026, 11, 6, 23, 59), now)).toBe('ontem 23:59');
    expect(formatMessageTime(at(2026, 11, 4, 8, 7), now)).toBe('04/11 08:07');
    expect(formatMessageTime(at(2025, 12, 31, 18, 30), now)).toBe('31/12/2025 18:30');
  });

  it('na virada do dia, 00:01 de hoje não é "ontem"', () => {
    const early = new Date(2026, 10, 7, 0, 5);
    expect(formatMessageTime(at(2026, 11, 7, 0, 1), early)).toBe('00:01');
    expect(formatMessageTime(at(2026, 11, 6, 23, 55), early)).toBe('ontem 23:55');
  });

  it('data inválida devolve vazio', () => {
    expect(formatMessageTime('não é data', now)).toBe('');
    expect(formatFullTime('não é data')).toBe('');
  });

  it('a dica completa traz dia da semana, data e segundos', () => {
    const full = formatFullTime(at(2026, 11, 7, 14, 32, 5));
    expect(full).toContain('sábado');
    expect(full).toContain('7 de novembro de 2026');
    expect(full).toContain('14:32:05');
  });
});
