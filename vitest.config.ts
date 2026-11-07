import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadBranding } from './scripts/branding.mjs';

export default defineConfig({
  define: { __NEXUS_BRAND__: JSON.stringify(loadBranding()) },
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // O cache persistente de módulos não percebe arquivos novos encontrados por import.meta.glob
    // (ex.: uma migração .sql nova), então os testes rodariam com a lista antiga.
    fsModuleCache: false,
  },
});
