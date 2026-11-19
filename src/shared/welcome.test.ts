import { describe, expect, it } from 'vitest';
import { greetingFor, sameLocalDay, sinceFor, sinceLabel, weekdayPhrase, WELCOME_MAX_DAYS } from './welcome';

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0, 0);
const DAY = 86_400_000;

describe('saudação', () => {
  it('muda com a hora e usa o nome quando houver', () => {
    expect(greetingFor(at(2026, 11, 19, 9), 'Ana')).toBe('Bom dia, Ana.');
    expect(greetingFor(at(2026, 11, 19, 14), 'Ana')).toBe('Boa tarde, Ana.');
    expect(greetingFor(at(2026, 11, 19, 21), null)).toBe('Boa noite.');
    expect(greetingFor(at(2026, 11, 19, 3), null)).toBe('Boa noite.');
  });

  it('o dia da semana concorda: uma ótima quinta-feira, um ótimo sábado', () => {
    expect(weekdayPhrase(at(2026, 11, 19))).toBe('Uma ótima quinta-feira.');
    expect(weekdayPhrase(at(2026, 11, 21))).toBe('Um ótimo sábado.');
    expect(weekdayPhrase(at(2026, 11, 22))).toBe('Um ótimo domingo.');
  });
});

describe('período do resumo', () => {
  const now = at(2026, 11, 19).getTime();

  it('parte da última tela vista, no máximo uma semana atrás', () => {
    const yesterday = new Date(now - DAY).toISOString();
    expect(sinceFor(yesterday, now)).toBe(now - DAY);
    expect(sinceFor(new Date(now - 30 * DAY).toISOString(), now)).toBe(now - WELCOME_MAX_DAYS * DAY);
  });

  it('na primeira vez (ou data inválida) cobre os últimos 3 dias', () => {
    expect(sinceFor(null, now)).toBe(now - 3 * DAY);
    expect(sinceFor('lixo', now)).toBe(now - 3 * DAY);
  });

  it('data no futuro (relógio diferente) não passa de agora', () => {
    expect(sinceFor(new Date(now + DAY).toISOString(), now)).toBe(now);
  });

  it('o rótulo diz desde quando', () => {
    expect(sinceLabel(now - DAY, now, false)).toBe('Desde ontem');
    expect(sinceLabel(now - 2 * DAY, now, false)).toBe('Desde anteontem');
    expect(sinceLabel(at(2026, 11, 16).getTime(), now, false)).toBe('Desde segunda-feira');
    expect(sinceLabel(now - 3 * DAY, now, true)).toBe('Nos últimos 3 dias');
    expect(sinceLabel(now - 1000, now, false)).toBe('Desde mais cedo hoje');
  });

  it('compara dias de calendário, não 24 horas', () => {
    expect(sameLocalDay(at(2026, 11, 19, 0).getTime(), at(2026, 11, 19, 23).getTime())).toBe(true);
    expect(sameLocalDay(at(2026, 11, 18, 23).getTime(), at(2026, 11, 19, 1).getTime())).toBe(false);
  });
});
