import fs from 'node:fs';
import { z } from 'zod';
import { DARK_VARIANT_IDS } from '@shared/palette';

/** Preferências necessárias antes do banco abrir (ex.: onde fica a pasta de conteúdo). */
export const preferencesSchema = z.object({
  version: z.literal(1).default(1),
  dataRoot: z.string().min(1).nullable().default(null),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Quando o aviso de privacidade foi confirmado (nulo: ainda não foi, e o app mostra o aviso). */
  privacyAcceptedAt: z.string().nullable().default(null),
  /** Variação do tema escuro escolhida em Configurações → Aparência. */
  darkVariant: z.enum(DARK_VARIANT_IDS).default('padrao'),
  /** Modelos que o usuário já viu (`null`: primeiro uso, ainda não registrado). Serve para avisar de modelo novo. */
  seenModels: z.array(z.string().max(100)).max(500).nullable().default(null),
  /** Modo de visualização da galáxia (Configurações → Aparência). */
  galaxyQuality: z.enum(['leve', 'original']).default('leve'),
  /** Estilo da galáxia: o visual de sempre ou o núcleo "Eclipse" (buraco negro). Independe do modo (Leve/Original). */
  galaxyLook: z.enum(['atual', 'eclipse']).default('atual'),
  /** Tela de boas-vindas na primeira abertura do dia (Configurações → Boas-vindas). */
  welcomeEnabled: z.boolean().default(true),
  /** Deixa o Claude (modelo pequeno) escrever o resumo da tela de boas-vindas. */
  welcomeAi: z.boolean().default(true),
  /** Nome na saudação (`null` = primeiro nome do `git config user.name`). */
  welcomeName: z.string().trim().max(40).nullable().default(null),
  /** Quando a tela de boas-vindas foi vista pela última vez (início do próximo resumo). */
  welcomeLastAt: z.string().nullable().default(null),
  /** Pasta ou endereço HTTPS de onde o Nexus se atualiza (`null` = desligado). */
  updateSource: z.string().trim().max(500).nullable().default(null),
  /** Cor de destaque escolhida (`null` = a da marca). */
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export interface LoadedPreferences {
  preferences: Preferences;
  /** Motivo pelo qual o arquivo foi ignorado e os padrões foram usados, se for o caso. */
  warning?: string;
}

export function loadPreferences(file: string): LoadedPreferences {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { preferences: preferencesSchema.parse({}) };
  }
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { preferences: parsed.data };
    return { preferences: preferencesSchema.parse({}), warning: `preferências inválidas: ${parsed.error.message}` };
  } catch (err) {
    return { preferences: preferencesSchema.parse({}), warning: `JSON inválido: ${(err as Error).message}` };
  }
}

/** Grava de forma atômica (arquivo temporário + rename) para nunca deixar um JSON pela metade. */
export function savePreferences(file: string, preferences: Preferences): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(preferencesSchema.parse(preferences), null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
