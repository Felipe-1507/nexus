import { createContext, useContext } from 'react';

/** Abre o arquivo citado numa resposta (nota, código ou Explorer). Fora de uma conversa não existe: os links ficam como estão. */
export type FileLinkHandler = (target: string) => Promise<void>;

const FileLinkContext = createContext<FileLinkHandler | null>(null);

export const FileLinkProvider = FileLinkContext.Provider;
export const useFileLinkHandler = (): FileLinkHandler | null => useContext(FileLinkContext);
