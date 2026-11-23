import { z } from 'zod';

/** Backup manual (Configurações → Backup). */
export const backupPreviewSchema = z.object({
  /** Tamanho da pasta de conteúdo (o banco entra a mais). */
  bytes: z.number(),
  files: z.number(),
  suggestedName: z.string(),
});
export type BackupPreview = z.infer<typeof backupPreviewSchema>;

export const backupResultSchema = z.object({ path: z.string(), bytes: z.number(), files: z.number() });
export type BackupResult = z.infer<typeof backupResultSchema>;
