import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

describe('buildCsp', () => {
  it('em produção não permite script inline nem conexões externas', () => {
    const csp = buildCsp();
    expect(directive(csp, 'default-src')).toBe("default-src 'none'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
  });

  it('em desenvolvimento libera só o necessário para o Vite', () => {
    const csp = buildCsp('http://localhost:5173');
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' ws://localhost:5173");
    expect(csp).not.toContain('unsafe-eval');
  });
});
