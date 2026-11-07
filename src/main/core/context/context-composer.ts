import { BRAND } from '@shared/brand';
export interface ContextInput {
  /** Instruções gerais do usuário (valem em todos os Workspaces). */
  globalInstructions: string;
  workspaceName: string;
  /** Conteúdo do workspace.md. */
  workspaceInstructions: string;
  /** Conversa de um projeto: pasta, instruções e onde ficam as notas do Workspace. */
  project?: { name: string; path: string; instructions: string; knowledgeDir: string };
  /**
   * Conversa geral do Workspace: os projetos que existem nele (nome, pasta, para que servem). Assim o "Geral" sabe quais
   * projetos há sem o usuário precisar manter uma lista à mão.
   */
  projects?: Array<{ name: string; path: string; summary: string; available: boolean }>;
  /** O que o Claude pode fazer neste Workspace (modo somente leitura ou não). */
  capabilities: 'read-only' | 'full';
  /** Segundo cérebro do Workspace: pasta e índice curto das notas. */
  knowledge?: { dir: string; lines: string[]; omitted: number };
}

/**
 * Monta o texto acrescentado ao prompt do Claude Code em cada conversa, em camadas: regras do Nexus (estilo
 * minimalista), instruções gerais, instruções do Workspace e, se houver, do projeto. Nunca inclui nada de outro
 * Workspace.
 */
export function composeSystemPrompt(input: ContextInput): string {
  const lines = [
    `# ${BRAND.productName}`,
    `Você está sendo usado dentro do ${BRAND.productName}, no Workspace "${input.workspaceName}".`,
    '',
    '## Como responder',
    '- Responda em português do Brasil, de forma direta e objetiva.',
    '- Trabalhe em silêncio: não anuncie o que vai fazer antes de usar ferramentas. Escreva apenas a resposta final.',
    '- Não cole código longo nem diffs na resposta, a menos que o usuário peça. Diga o que foi feito e em quais arquivos.',
  ];
  if (input.capabilities === 'read-only') {
    lines.push(
      '- Este Workspace está em modo somente leitura: você pode ler e pesquisar arquivos, mas não criar, editar nem executar comandos. Se pedirem, explique isso em uma frase.',
    );
  } else {
    lines.push(
      '- Você pode criar e editar arquivos e executar comandos. Prefira alterações pequenas e focadas no pedido.',
      '- Se uma ação for negada pelo usuário, não tente contorná-la: diga em uma frase o que ficou por fazer.',
    );
  }

  const global = input.globalInstructions.trim();
  if (global) lines.push('', '## Instruções gerais do usuário', global);

  lines.push(
    '',
    `## Instruções do Workspace "${input.workspaceName}"`,
    input.workspaceInstructions.trim() || '(nenhuma instrução definida)',
  );

  if (input.project) {
    const p = input.project;
    lines.push(
      '',
      `## Projeto "${p.name}"`,
      `Você está trabalhando na pasta do projeto: ${p.path}`,
      `As notas do Workspace ficam em ${p.knowledgeDir} e podem ser consultadas quando ajudarem.`,
      p.instructions.trim() || '(nenhuma instrução específica do projeto)',
    );
  }
  if (!input.project && input.projects && input.projects.length > 0) {
    lines.push('', ...projectsSection(input.projects, input.capabilities));
  }
  if (input.knowledge) lines.push('', ...knowledgeSection(input.knowledge, input.capabilities));
  return lines.join('\n');
}

/** Quantos projetos entram na lista (um Workspace com muitos projetos não deve estourar o prompt). */
const PROJECTS_LIMIT = 40;
const SUMMARY_MAX_CHARS = 160;

/** Primeira linha útil das instruções de um projeto, curta, para a lista do "Geral". */
export function summarizeInstructions(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…` : line;
}

/** Visão de conjunto para a conversa geral: quais projetos existem e como trabalhar com eles. */
function projectsSection(
  projects: NonNullable<ContextInput['projects']>,
  capabilities: 'read-only' | 'full',
): string[] {
  const shown = projects.slice(0, PROJECTS_LIMIT);
  const out = [
    '## Projetos deste Workspace',
    'Esta é a conversa geral: você conhece todos os projetos abaixo e mantém a visão de conjunto.',
    ...shown.map(
      (p) =>
        `- ${p.name} — pasta: ${p.path}${p.available ? '' : ' (pasta inacessível agora)'}${p.summary ? ` — ${p.summary}` : ''}`,
    ),
  ];
  if (projects.length > shown.length) out.push(`(+${projects.length - shown.length} projetos fora desta lista)`);
  out.push(
    'Para responder sobre um projeto, comece pelas notas do vault. Se precisar do código, leia a pasta dele (o usuário confirma o acesso). Prefira que alterações no código sejam feitas na conversa do próprio projeto.',
  );
  if (capabilities === 'full') {
    out.push(
      'Mantenha no vault uma pasta de notas para cada projeto (com o nome do projeto) e a nota "Mapa dos sistemas", que liga todos eles e descreve as integrações entre eles.',
    );
  }
  return out;
}

/**
 * Segundo cérebro: o índice curto (o Claude abre só a nota que precisar) e as regras de curadoria. As notas são do
 * usuário e compatíveis com o Obsidian; atualizar é melhor que duplicar.
 */
function knowledgeSection(
  k: NonNullable<ContextInput['knowledge']>,
  capabilities: ContextInput['capabilities'],
): string[] {
  const out = [
    '## Segundo cérebro (notas deste Workspace)',
    `As notas ficam em ${k.dir}, em Markdown compatível com o Obsidian ([[links]], #tags, frontmatter).`,
    'Antes de responder sobre processos, sistemas, decisões ou rotinas, consulte as notas relevantes do índice.',
  ];
  if (capabilities === 'full') {
    out.push(
      'Você é o curador destas notas:',
      '- Quando o usuário pedir para registrar ou lembrar algo, ou quando surgir algo duradouro (decisão, processo, regra), registre numa nota.',
      '- Atualize a nota existente do assunto em vez de criar outra. Nota nova: nome curto em português, na pasta adequada, começando com "# Título" e uma linha de resumo.',
      '- Ligue a notas relacionadas com [[Nome da Nota]] e use #tags.',
      '- Ao registrar, termine a resposta com uma frase curta, como "Registrei em [[Nome da Nota]]."',
      '- Nunca guarde senhas, tokens ou dados pessoais sensíveis nas notas.',
    );
  }
  out.push('', 'Índice (caminho — título: resumo):');
  out.push(...(k.lines.length ? k.lines : ['(nenhuma nota ainda)']));
  if (k.omitted > 0) out.push(`(+${k.omitted} notas fora deste índice: procure na pasta com Glob/Grep)`);
  return out;
}
