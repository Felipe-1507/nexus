import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'release/', 'node_modules/', 'spikes/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Scripts de linha de comando rodam no Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // Regra de arquitetura: o renderer nunca importa código do processo main nem do Node.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/main/**', '**/preload/**'], message: 'O renderer só conversa com o main via window.nexus.' },
            { group: ['node:*', 'electron'], message: 'O renderer não tem acesso ao Node nem ao Electron.' },
          ],
        },
      ],
    },
  },
);
