import path from 'node:path';
import { BRAND } from '@shared/brand';

export interface AppPaths {
  /** %APPDATA%\<nome do app>: banco, preferências e logs. */
  userData: string;
  preferences: string;
  database: string;
  logs: string;
  /**
   * Pasta de conteúdo visível ao usuário (Workspaces, notas). Padrão: <perfil do usuário>\<nome do app>.
   * Não usa Documentos porque ela costuma ser sincronizada pelo OneDrive (ADR 0002).
   */
  dataRoot: string;
}

export function resolveAppPaths(
  userData: string,
  home: string,
  dataRootPreference: string | null,
  appName: string = BRAND.productName,
): AppPaths {
  return {
    userData,
    preferences: path.join(userData, 'preferences.json'),
    database: path.join(userData, 'nexus.db'),
    logs: path.join(userData, 'logs'),
    dataRoot: dataRootPreference ?? path.join(home, appName),
  };
}
