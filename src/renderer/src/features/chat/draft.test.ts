import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, readDraft, writeDraft } from './draft';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const att = {
  id: '3f2b8c1e-7a4d-4e6f-9a1b-2c3d4e5f6a7b',
  name: 'print.png',
  mime: 'image/png' as const,
  size: 1234,
};

describe('rascunho da mensagem', () => {
  it('guarda texto e anexos por chave, sem misturar conversas', () => {
    const s = memoryStorage();
    writeDraft('conversa-a', { text: 'olá', attachments: [att] }, s);
    writeDraft('conversa-b', { text: 'outra', attachments: [] }, s);
    expect(readDraft('conversa-a', s)).toEqual({ text: 'olá', attachments: [att] });
    expect(readDraft('conversa-b', s)).toEqual({ text: 'outra', attachments: [] });
    expect(readDraft('conversa-c', s)).toEqual(EMPTY_DRAFT);
  });

  it('só anexos, sem texto, também é um rascunho; vazio apaga a entrada', () => {
    const s = memoryStorage();
    writeDraft('k', { text: '', attachments: [att] }, s);
    expect(readDraft('k', s).attachments).toEqual([att]);
    writeDraft('k', { text: '', attachments: [] }, s);
    expect(s.length).toBe(0);
  });

  it('não guarda a miniatura, só os campos do anexo', () => {
    const s = memoryStorage();
    writeDraft('k', { text: '', attachments: [{ ...att, thumb: 'data:image/png;base64,AAAA' } as typeof att] }, s);
    expect(s.getItem('nexus.draft2.k')).not.toContain('data:image');
  });

  it('lê o formato antigo (só texto) e o troca pelo novo na próxima gravação', () => {
    const s = memoryStorage();
    s.setItem('nexus.draft.k', 'texto antigo');
    expect(readDraft('k', s)).toEqual({ text: 'texto antigo', attachments: [] });
    writeDraft('k', { text: 'texto antigo mais', attachments: [] }, s);
    expect(s.getItem('nexus.draft.k')).toBeNull();
    expect(readDraft('k', s).text).toBe('texto antigo mais');
  });

  it('dado corrompido ou sem chave vira rascunho vazio, sem erro', () => {
    const s = memoryStorage();
    s.setItem('nexus.draft2.k', '{não é json');
    expect(readDraft('k', s)).toEqual(EMPTY_DRAFT);
    s.setItem('nexus.draft2.k', JSON.stringify({ text: 1, attachments: 'x' }));
    expect(readDraft('k', s)).toEqual(EMPTY_DRAFT);
    expect(readDraft(undefined, s)).toEqual(EMPTY_DRAFT);
    expect(readDraft('k', null)).toEqual(EMPTY_DRAFT);
  });
});
