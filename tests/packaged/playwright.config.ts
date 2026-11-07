import { defineConfig } from '@playwright/test';

// Testes do app empacotado (release/win-unpacked). Rodar com `npm run test:packaged`, que gera o pacote antes.
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
});
