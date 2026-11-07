import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

/** Tempo mínimo da abertura animada em SVG: o bastante para formar o logo, sem atrasar quem só quer trabalhar. */
export const SPLASH_MIN_MS = 2_000;
/** Duração do vídeo de abertura (build/intro/intro.webm): a janela só some depois dele, e ele fica no último quadro. */
export const INTRO_VIDEO_MS = 4_100;
const FADE_MS = 160;

const HEX = /^#[0-9a-f]{6}/i;

/** Mistura duas cores `#rrggbb` (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Página da abertura: o ícone do app se monta (fundo, planeta girando, órbita se desenhando com a lua dando a volta)
 * e o nome aparece. Só HTML e CSS, sem nenhum script. Com "reduzir movimento" do Windows, mostra direto o logo pronto.
 */
export function splashHtml({ accent, name }: { accent: string; name: string }): string {
  const a = HEX.test(accent) ? accent.slice(0, 7) : '#8b7dff';
  const light = mixHex(a, '#ffffff', 0.55);
  const pale = mixHex(a, '#ffffff', 0.8);
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; cursor: default; }
  body { display: grid; place-items: center; font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
  svg { width: 240px; height: 240px; overflow: visible; }
  .tile { transform-box: view-box; transform-origin: 256px 256px; animation: pop .55s cubic-bezier(.2,.9,.3,1.25) both; }
  .glow { transform-box: view-box; transform-origin: 256px 256px; animation: glow 1s .25s ease-out both, breathe 2.4s 1.8s ease-in-out infinite; }
  .core { transform-box: view-box; transform-origin: 256px 256px; animation: pop .6s .3s cubic-bezier(.2,.9,.3,1.4) both; }
  .bands { animation: spin 1.6s .3s cubic-bezier(.3,.6,.4,1) both; }
  .orbit { transform-box: view-box; transform-origin: 256px 256px; transform: rotate(-24deg);
           animation: swing 1.5s .55s cubic-bezier(.25,.8,.3,1) both; }
  .ring { stroke-dasharray: 820; stroke-dashoffset: 0; animation: draw 1.2s .6s ease-out both; }
  .moon { transform-box: fill-box; transform-origin: center; animation: pop .4s .9s ease-out both; }
  .name { fill: #ece9ff; font-size: 44px; font-weight: 600; letter-spacing: .02em;
          transform-box: fill-box; transform-origin: center; animation: rise .6s 1.45s ease-out both; }
  @keyframes pop { from { transform: scale(0); opacity: 0; } }
  @keyframes glow { from { transform: scale(.3); opacity: 0; } }
  @keyframes breathe { 50% { opacity: .7; transform: scale(.94); } }
  @keyframes spin { from { transform: translateX(-150px); } }
  @keyframes swing { from { transform: rotate(-384deg); } }
  @keyframes draw { from { stroke-dashoffset: 820; } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); letter-spacing: .4em; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style></head>
<body>
<svg viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(name)} abrindo">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c1c2e"/><stop offset="1" stop-color="#0b0b12"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="${light}" stop-opacity=".95"/>
      <stop offset=".35" stop-color="${a}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core" cx=".4" cy=".38" r=".65">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="${pale}"/><stop offset="1" stop-color="${a}"/>
    </radialGradient>
    <clipPath id="planet"><circle cx="256" cy="256" r="66"/></clipPath>
  </defs>
  <g class="tile">
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#tile)"/>
    <rect x="16.5" y="16.5" width="479" height="479" rx="111.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
  </g>
  <circle class="glow" cx="256" cy="256" r="190" fill="url(#glow)"/>
  <g class="core">
    <circle cx="256" cy="256" r="66" fill="url(#core)"/>
    <g clip-path="url(#planet)"><g class="bands" fill="${a}" fill-opacity=".22">
      <ellipse cx="236" cy="232" rx="44" ry="9"/><ellipse cx="282" cy="262" rx="52" ry="10"/>
      <ellipse cx="244" cy="290" rx="38" ry="8"/><ellipse cx="86" cy="232" rx="44" ry="9"/>
      <ellipse cx="132" cy="262" rx="52" ry="10"/><ellipse cx="94" cy="290" rx="38" ry="8"/>
    </g></g>
  </g>
  <g class="orbit">
    <ellipse class="ring" cx="256" cy="256" rx="178" ry="70" fill="none" stroke="${a}" stroke-opacity=".7" stroke-width="12"/>
    <circle class="moon" cx="410.7" cy="220.9" r="22" fill="#5cc8ff"/>
  </g>
  <text class="name" x="256" y="452" text-anchor="middle">${escapeHtml(name)}</text>
</svg>
</body></html>`;
}

/** Pasta do vídeo de abertura: ao lado do projeto em desenvolvimento, em `resources/intro` no app instalado. */
export function introDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'intro') : path.join(app.getAppPath(), 'build', 'intro');
}

/** Página do vídeo, se ele existir e a marca for a padrão (o vídeo traz o nome "Nexus" desenhado). */
export function introVideoPage(isDefaultBrand: boolean): string | null {
  if (!isDefaultBrand) return null;
  const dir = introDir();
  const page = path.join(dir, 'splash.html');
  return fs.existsSync(page) && fs.existsSync(path.join(dir, 'intro.webm')) ? page : null;
}

export interface Splash {
  /** Mostra a janela principal quando a animação já teve tempo de formar o logo, e fecha a abertura. */
  finish(showMain: () => void): void;
}

/** Janela quadrada e sem moldura no centro da tela, aberta antes de tudo. Sem preload, sem Node e sem JavaScript. */
export function openSplash({
  accent,
  name,
  icon,
  video,
}: {
  accent: string;
  name: string;
  icon?: string | null;
  /** Página HTML do vídeo de abertura; sem ela, vale a animação em SVG. */
  video?: string | null;
}): Splash {
  const win = new BrowserWindow({
    width: video ? 420 : 260,
    height: video ? 420 : 260,
    center: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: name,
    ...(icon ? { icon } : {}),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      devTools: false,
    },
  });
  let shownAt: number | null = null;
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    shownAt = Date.now();
  });
  if (video) void win.loadFile(video);
  else void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml({ accent, name }))}`);
  const minMs = video ? INTRO_VIDEO_MS : SPLASH_MIN_MS;

  const close = () => {
    if (win.isDestroyed()) return;
    // Some suave em vez de piscar.
    const steps = 8;
    let i = 0;
    const timer = setInterval(() => {
      if (win.isDestroyed()) return clearInterval(timer);
      win.setOpacity(Math.max(0, 1 - ++i / steps));
      if (i >= steps) {
        clearInterval(timer);
        win.destroy();
      }
    }, FADE_MS / steps);
  };

  return {
    finish(showMain) {
      // A abertura nem chegou a aparecer (ou o usuário a fechou): o app entra direto.
      if (win.isDestroyed() || shownAt === null) {
        showMain();
        if (!win.isDestroyed()) win.destroy();
        return;
      }
      const wait = Math.max(0, minMs - (Date.now() - shownAt));
      setTimeout(() => {
        showMain();
        close();
      }, wait);
    },
  };
}
