import { describe, expect, it } from 'vitest';
import { createOriginGuard, originOf } from './origin';

describe('originOf', () => {
  it('funciona para o esquema próprio e para http', () => {
    expect(originOf('nexus://app/index.html')).toBe('nexus://app');
    expect(originOf('http://localhost:5173/src/main.tsx')).toBe('http://localhost:5173');
  });

  it('devolve null para URLs inválidas ou sem host', () => {
    expect(originOf('não é url')).toBeNull();
    expect(originOf('about:blank')).toBeNull();
  });
});

describe('createOriginGuard', () => {
  const trusted = createOriginGuard(['nexus://app']);

  it('aceita só a origem do app', () => {
    expect(trusted('nexus://app/index.html')).toBe(true);
    expect(trusted('nexus://app/assets/x.js')).toBe(true);
  });

  it('recusa outras origens, hosts parecidos e vazios', () => {
    expect(trusted('nexus://outro/index.html')).toBe(false);
    expect(trusted('nexus://app.evil/index.html')).toBe(false);
    expect(trusted('https://example.com/')).toBe(false);
    expect(trusted('file:///C:/dev/nexus/out/renderer/index.html')).toBe(false);
    expect(trusted(undefined)).toBe(false);
    expect(trusted('')).toBe(false);
  });
});
