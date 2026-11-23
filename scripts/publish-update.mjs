// Publica a versão gerada por `npm run dist` num lugar que o Nexus consulta para se atualizar:
//
//   node scripts/publish-update.mjs <pasta-de-destino>
//
// Copia o instalador (release/<nome>-<versão>-instalador.exe) para a pasta e grava, por último, o `nexus-update.json`
// com a versão, o nome do arquivo e o SHA-512 dele. A versão vem do package.json: suba-a antes de rodar `npm run dist`,
// senão o app não enxerga nada de novo. Se a pasta for servida por um endereço HTTPS, basta apontar o Nexus para ele.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactBase, loadBranding } from './branding.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_NAME = 'nexus-update.json';

/** SHA-512 (hex) de um arquivo, lido em partes. */
export async function sha512File(file) {
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Manifesto de uma versão, a partir do instalador que já está no disco. */
export async function buildManifest({ version, installer, now = new Date() }) {
  return {
    version,
    file: path.basename(installer),
    sha512: await sha512File(installer),
    releasedAt: now.toISOString(),
  };
}

/** Copia o instalador e só então grava o manifesto (que o app lê), de forma atômica. Devolve o manifesto. */
export async function publish({ installer, version, destDir, now = new Date() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versão inválida no package.json: ${version}`);
  if (!fs.existsSync(installer)) throw new Error(`Instalador não encontrado: ${installer}. Rode "npm run dist" antes.`);
  fs.mkdirSync(destDir, { recursive: true });
  const target = path.join(destDir, path.basename(installer));
  fs.copyFileSync(installer, `${target}.parcial`);
  fs.renameSync(`${target}.parcial`, target);
  const manifest = await buildManifest({ version, installer: target, now });
  const tmp = path.join(destDir, `${MANIFEST_NAME}.parcial`);
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, path.join(destDir, MANIFEST_NAME));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2];
  if (!dest) {
    console.error('Uso: node scripts/publish-update.mjs <pasta-de-destino>');
    process.exit(1);
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const installer = path.join(root, 'release', `${artifactBase(loadBranding())}-${version}-instalador.exe`);
  publish({ installer, version, destDir: path.resolve(dest) })
    .then((m) => console.log(`Publicado ${m.file} (versão ${m.version}) em ${path.resolve(dest)}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
