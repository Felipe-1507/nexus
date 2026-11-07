/**
 * Cores de texto das notas. Ficam gravadas no próprio arquivo como `<span style="color:#rrggbb">texto</span>`
 * (HTML que o Obsidian também entende), por isso aqui os valores são literais e não variáveis do tema: tons médios,
 * legíveis no claro e no escuro.
 */
export const NOTE_COLORS = [
  { id: 'gray', label: 'Cinza', hex: '#8b8b87' },
  { id: 'brown', label: 'Marrom', hex: '#a0715a' },
  { id: 'orange', label: 'Laranja', hex: '#d9730d' },
  { id: 'yellow', label: 'Amarelo', hex: '#cb9b0a' },
  { id: 'green', label: 'Verde', hex: '#2f9e6d' },
  { id: 'blue', label: 'Azul', hex: '#2e86c1' },
  { id: 'purple', label: 'Roxo', hex: '#8e5bd0' },
  { id: 'pink', label: 'Rosa', hex: '#d0508a' },
  { id: 'red', label: 'Vermelho', hex: '#e03e3e' },
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** Só este formato é reconhecido (no editor e na visualização): nada de HTML arbitrário. */
export const COLOR_OPEN = /^<span style="color:\s*(#[0-9a-fA-F]{6})">$/;
export const COLOR_SPAN = /<span style="color:\s*(#[0-9a-fA-F]{6})">(.*?)<\/span>/g;

export const colorOpenTag = (hex: string) => `<span style="color:${hex}">`;
export const COLOR_CLOSE_TAG = '</span>';
