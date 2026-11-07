// Marca do app (nome, identificador, autor, cores, logo e ícone), escolhida na hora de compilar e de gerar o instalador.
//
// Sem nada local, vale a marca padrão, "Nexus", com a aparência padrão. Para outra marca, crie na raiz do repositório
// a pasta `branding.local/` (fora do git) com:
//
//   branding.json   { "productName": "Meu Nexus", "appId": "com.exemplo.meunexus", "author": "Meu nome" }
//   theme.json      (opcional) cores: { "dark": { "bg": "#0a1020", "accent": "#4f8cff" }, "light": {…}, "galaxy": […] }
//   logo.svg/.png   (opcional) logo da barra de título e da tela inicial
//   icon.png        (opcional) ícone do app e do instalador, quadrado, com pelo menos 256×256
//
// Só o nome também pode vir de um arquivo `branding.local.json`. O nome define as pastas de dados
// (%APPDATA%\<nome> e %USERPROFILE%\<nome>), então duas marcas convivem no mesmo computador.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LOCAL_BRANDING_DIR = path.join(root, 'branding.local');
export const LOCAL_BRANDING_FILE = path.join(root, 'branding.local.json');
/** Ícone padrão, genérico, versionado no repositório. */
export const DEFAULT_ICON = path.join(root, 'build', 'icon.png');

/** @type {import('./branding.mjs').Branding} */
export const DEFAULT_BRANDING = Object.freeze({
  productName: 'Nexus',
  appId: 'local.nexus.app',
  author: null,
  theme: null,
  logo: null,
  icon: null,
});

/** Mesmas chaves de `src/shared/palette.ts` (um teste confere que as duas listas batem). */
export const THEME_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'titlebar',
  'border',
  'text',
  'text-muted',
  'accent',
  'accent-soft',
  'ok',
  'danger',
];

// O nome vira nome de pasta e de executável no Windows.
const INVALID_NAME = /[\\/:*?"<>|]|^\s|\s$|\.$/;
const APP_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/i;
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LOGO_MAX_BYTES = 512 * 1024;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.basename(file)}: JSON inválido (${err.message}).`, { cause: err });
  }
};

function checkIdentity(raw, problems) {
  const b = { productName: DEFAULT_BRANDING.productName, appId: DEFAULT_BRANDING.appId, author: null, ...raw };
  if (typeof b.productName !== 'string' || !b.productName || INVALID_NAME.test(b.productName)) {
    problems.push('productName precisa ser um nome válido de pasta no Windows');
  }
  if (typeof b.appId !== 'string' || !APP_ID.test(b.appId))
    problems.push('appId precisa ser no formato com.exemplo.app');
  if (b.author !== null && (typeof b.author !== 'string' || !b.author.trim())) {
    problems.push('author precisa ser um texto ou null');
  }
  return { productName: b.productName, appId: b.appId, author: b.author };
}

function checkTheme(raw, problems) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('theme.json precisa ser um objeto com "light", "dark" e/ou "galaxy"');
    return null;
  }
  const theme = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'light' || key === 'dark') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`theme.json: "${key}" precisa ser um objeto de cores`);
        continue;
      }
      for (const [token, color] of Object.entries(value)) {
        if (!THEME_TOKENS.includes(token))
          problems.push(`theme.json: "${key}.${token}" não existe (use: ${THEME_TOKENS.join(', ')})`);
        else if (typeof color !== 'string' || !HEX.test(color))
          problems.push(`theme.json: "${key}.${token}" precisa ser #rrggbb`);
      }
      theme[key] = { ...value };
    } else if (key === 'galaxy') {
      if (!Array.isArray(value) || value.length === 0 || !value.every((c) => typeof c === 'string' && HEX.test(c))) {
        problems.push('theme.json: "galaxy" precisa ser uma lista de cores #rrggbb');
      } else theme.galaxy = [...value];
    } else {
      problems.push(`theme.json: "${key}" não existe (use light, dark ou galaxy)`);
    }
  }
  return theme;
}

function readLogo(dir, problems) {
  for (const [file, mime] of [
    ['logo.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
  ]) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const bytes = fs.readFileSync(full);
    if (bytes.length > LOGO_MAX_BYTES) {
      problems.push(`${file} passa de 512 KB`);
      return null;
    }
    // Vai embutida no app (o CSP só aceita imagens do próprio app ou data:).
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  return null;
}

/** Tamanho de um PNG pelo cabeçalho IHDR, ou null se não for PNG. */
function pngSize(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function checkIcon(dir, problems) {
  const full = path.join(dir, 'icon.png');
  if (!fs.existsSync(full)) return null;
  const size = pngSize(fs.readFileSync(full));
  if (!size) problems.push('icon.png precisa ser um PNG');
  else if (size.width !== size.height || size.width < 256) {
    problems.push(`icon.png precisa ser quadrado, com pelo menos 256×256 (tem ${size.width}×${size.height})`);
  }
  return full;
}

/**
 * @param {{ dir?: string, file?: string }} [where] onde procurar (os testes usam pastas temporárias)
 * @returns {import('./branding.mjs').Branding}
 */
export function loadBranding({ dir = LOCAL_BRANDING_DIR, file = LOCAL_BRANDING_FILE } = {}) {
  const problems = [];
  let branding;
  if (fs.existsSync(dir)) {
    const json = path.join(dir, 'branding.json');
    const identity = checkIdentity(fs.existsSync(json) ? readJson(json) : {}, problems);
    const themeFile = path.join(dir, 'theme.json');
    branding = {
      ...identity,
      theme: fs.existsSync(themeFile) ? checkTheme(readJson(themeFile), problems) : null,
      logo: readLogo(dir, problems),
      icon: checkIcon(dir, problems),
    };
  } else if (fs.existsSync(file)) {
    branding = { ...DEFAULT_BRANDING, ...checkIdentity(readJson(file), problems) };
  } else {
    return DEFAULT_BRANDING;
  }
  if (problems.length) throw new Error(`Marca local inválida: ${problems.join('; ')}.`);
  return branding;
}

/** Nome do arquivo do instalador: sem espaços. */
export function artifactBase(branding) {
  return branding.productName.trim().replace(/\s+/g, '-');
}
