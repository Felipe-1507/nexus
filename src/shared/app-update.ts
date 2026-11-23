import { z } from 'zod';

/**
 * Atualização do próprio Nexus. Cada versão publicada fica numa pasta (local ou de rede) ou num endereço HTTPS, com o
 * instalador e um `nexus-update.json` que diz a versão, o arquivo e o SHA-512 dele. O app consulta esse lugar e, com
 * a sua confirmação, confere o arquivo, roda o instalador em silêncio e reabre.
 */

export const UPDATE_MANIFEST_NAME = 'nexus-update.json';

export const updateManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'versão no formato 1.2.3'),
  /** Só o nome do arquivo do instalador, na mesma pasta do manifesto. */
  file: z
    .string()
    .regex(/^[^\\/:*?"<>|]+\.exe$/i, 'nome de instalador inválido')
    .max(200),
  /** SHA-512 do instalador, em hexadecimal. */
  sha512: z.string().regex(/^[0-9a-f]{128}$/i),
  releasedAt: z.string().optional(),
});
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export const appUpdateSettingsSchema = z.object({
  /** Pasta (ex.: `\\servidor\nexus-versoes`) ou endereço `https://…/`; `null` = atualização desligada. */
  source: z.string().trim().max(500).nullable(),
});
export type AppUpdateSettings = z.infer<typeof appUpdateSettingsSchema>;

export const appUpdateStatusSchema = z.object({
  configured: z.boolean(),
  current: z.string(),
  latest: z.string().nullable(),
  available: z.boolean(),
  /** Por que não deu para consultar (pasta fora do ar, manifesto inválido…); `null` = consulta ok ou desligada. */
  error: z.string().nullable(),
  checkedAt: z.string().nullable(),
});
export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>;
