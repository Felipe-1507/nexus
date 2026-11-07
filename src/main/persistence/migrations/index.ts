import { migrationsFromFiles } from '../migrator';

// Os arquivos .sql entram no bundle como texto: nada para copiar no empacotamento.
const files = import.meta.glob<string>('./*.sql', { query: '?raw', import: 'default', eager: true });

export const migrations = migrationsFromFiles(files);
