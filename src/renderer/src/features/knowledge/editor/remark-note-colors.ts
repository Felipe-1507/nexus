import { COLOR_OPEN } from './note-colors';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName: string; hProperties: Record<string, string> };
}

/**
 * Faz a visualização da nota mostrar as cores: `<span style="color:#rrggbb">texto</span>` vira um `span` colorido.
 * O HTML bruto continua não sendo renderizado; só este formato exato (que o próprio editor grava) é reconhecido.
 */
export function remarkNoteColors() {
  const walk = (node: MdNode) => {
    const kids = node.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const open = kids[i]!.type === 'html' ? COLOR_OPEN.exec(kids[i]!.value ?? '') : null;
      if (!open) continue;
      const close = kids.findIndex((k, j) => j > i && k.type === 'html' && k.value === '</span>');
      if (close === -1) continue;
      const inner = kids.slice(i + 1, close);
      kids.splice(i, close - i + 1, {
        type: 'noteColor',
        data: { hName: 'span', hProperties: { style: `color:${open[1]}` } },
        children: inner,
      });
    }
    kids.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}
