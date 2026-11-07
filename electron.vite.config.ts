import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { DEFAULT_ICON, loadBranding } from './scripts/branding.mjs';
import { DEFAULT_PALETTE, mergePalette, paletteCss } from './src/shared/palette';

const shared = { '@shared': resolve('src/shared') };
// Marca do app (padrão "Nexus" ou a de branding.local/), embutida como constante em main, preload e interface.
const branding = loadBranding();

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const brandTitle: Plugin = {
  name: 'nexus-brand-title',
  transformIndexHtml: (html: string) =>
    html.replace(/<title>.*<\/title>/, `<title>${escapeHtml(branding.productName)}</title>`),
};

// As variáveis de cor saem de src/shared/palette.ts com as trocas da marca, como CSS normal do pacote (o CSP do app
// não deixa a interface injetar estilos depois).
const THEME_MODULE = 'virtual:nexus-theme.css';
const themeCss: Plugin = {
  name: 'nexus-theme',
  resolveId: (id: string) => (id === THEME_MODULE ? `\0${THEME_MODULE}` : undefined),
  load: (id: string) =>
    id === `\0${THEME_MODULE}` ? paletteCss(mergePalette(DEFAULT_PALETTE, branding.theme)) : undefined,
};

export default defineConfig(({ command }) => {
  // O ícone só serve à janela em desenvolvimento; o app instalado usa o do executável. Assim nenhum caminho da máquina
  // de quem compilou vai para dentro do pacote.
  const brand = { ...branding, icon: command === 'serve' ? (branding.icon ?? DEFAULT_ICON) : null };
  const define = { __NEXUS_BRAND__: JSON.stringify(brand) };
  return {
    main: {
      resolve: { alias: shared },
      define,
    },
    preload: {
      resolve: { alias: shared },
      define,
      build: {
        // Preload em sandbox precisa ser CommonJS e autocontido.
        externalizeDeps: false,
        rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
      },
    },
    renderer: {
      resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
      define,
      plugins: [react(), tailwindcss(), brandTitle, themeCss],
    },
  };
});
