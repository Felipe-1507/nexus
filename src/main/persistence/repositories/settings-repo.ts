import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';

/** Configurações chave → valor JSON, validadas na leitura (um valor corrompido vira `undefined`). */
export class SettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  get<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
