import {
  greetingFor,
  sameLocalDay,
  sinceFor,
  sinceLabel,
  weekdayPhrase,
  type WelcomeDue,
  type WelcomeRecap,
  type WelcomeSettings,
} from '@shared/welcome';
import type { Preferences } from '../../platform/preferences';
import {
  assembleItems,
  buildTopics,
  countsOf,
  factsPrompt,
  parseSummary,
  RECAP_SYSTEM_PROMPT,
  type FactSources,
} from './welcome-facts';

export interface WelcomeDeps {
  prefs: { get(): Preferences; update(patch: Partial<Preferences>): Preferences };
  /** Projetos do Workspace cuja pasta está acessível. */
  projects: (workspaceId: string) => Promise<{ id: string; name: string; path: string }[]>;
  /** Notas do Workspace (título, sistema e última alteração). */
  notes: (workspaceId: string) => Promise<{ title: string; system: string; mtimeMs: number }[]>;
  conversations: (workspaceId: string) => { title: string; projectId: string | null; updatedAt: string }[];
  /** Assuntos dos commits da pasta desde `sinceIso`; sem git ou sem repositório, lista vazia. */
  gitLog: (dir: string, sinceIso: string) => Promise<string[]>;
  /** Nome do `git config user.name`, se houver. */
  gitUser: () => Promise<string | null>;
  /** Reescreve os fatos com o Claude; `null` quando o Claude Code não está pronto. Pode falhar (cai no texto local). */
  summarize: (system: string, prompt: string) => Promise<string | null>;
  onWarn?: (message: string, detail?: unknown) => void;
  now?: () => number;
}

/** Resumo da primeira abertura do dia. Nada aqui grava arquivo do usuário nem chama o Claude sem permissão. */
export class WelcomeService {
  private gitName: Promise<string | null> | null = null;

  constructor(private readonly deps: WelcomeDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  settings(): WelcomeSettings {
    const p = this.deps.prefs.get();
    return { enabled: p.welcomeEnabled, ai: p.welcomeAi, name: p.welcomeName };
  }

  setSettings(patch: Partial<WelcomeSettings>): WelcomeSettings {
    const next: Partial<Preferences> = {};
    if (patch.enabled !== undefined) next.welcomeEnabled = patch.enabled;
    if (patch.ai !== undefined) next.welcomeAi = patch.ai;
    if (patch.name !== undefined) next.welcomeName = patch.name?.trim() || null;
    this.deps.prefs.update(next);
    return this.settings();
  }

  /** `force`: ignora "já viu hoje" e o interruptor (botão "Ver agora" nas Configurações). */
  async due(force: boolean): Promise<WelcomeDue> {
    const now = this.now();
    const prefs = this.deps.prefs.get();
    const lastAt = prefs.welcomeLastAt;
    const last = lastAt ? Date.parse(lastAt) : NaN;
    const first = Number.isNaN(last) && !force;
    // "Ver agora" (Configurações) mostra o último dia, já que hoje a tela pode ter sido vista.
    const since = force ? now - 86_400_000 : sinceFor(lastAt, now);
    const date = new Date(now);
    const name = prefs.welcomeName ?? (await this.firstName());
    return {
      due: force || (prefs.welcomeEnabled && (Number.isNaN(last) || !sameLocalDay(last, now))),
      greeting: greetingFor(date, name),
      weekday: weekdayPhrase(date),
      since: new Date(since).toISOString(),
      sinceLabel: sinceLabel(since, now, first),
    };
  }

  /** Marca a tela de hoje como vista: a próxima abertura do dia não repete e o próximo resumo parte daqui. */
  seen(): null {
    this.deps.prefs.update({ welcomeLastAt: new Date(this.now()).toISOString() });
    return null;
  }

  async recap(workspaceId: string, sinceIso: string, label: string): Promise<WelcomeRecap> {
    const sinceMs = Date.parse(sinceIso);
    const projects = await this.deps.projects(workspaceId);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const sources: FactSources = {
      projects: await Promise.all(
        projects.map(async (p) => ({
          name: p.name,
          commits: await this.deps.gitLog(p.path, sinceIso).catch(() => []),
        })),
      ),
      notes: (await this.deps.notes(workspaceId).catch(() => [])).filter((n) => n.mtimeMs >= sinceMs),
      conversations: this.deps
        .conversations(workspaceId)
        .filter((c) => Date.parse(c.updatedAt) >= sinceMs)
        .map((c) => ({ title: c.title, project: c.projectId ? (names.get(c.projectId) ?? null) : null })),
    };
    const topics = buildTopics(sources);
    const counts = countsOf(topics);
    if (topics.length === 0) return { items: [], counts, source: 'local' };

    let summary: Map<string, string> | null = null;
    if (this.deps.prefs.get().welcomeAi) {
      try {
        const raw = await this.deps.summarize(RECAP_SYSTEM_PROMPT, factsPrompt(topics, label));
        if (raw) summary = parseSummary(raw);
      } catch (err) {
        this.deps.onWarn?.('O Claude não escreveu o resumo de boas-vindas; usando o texto local', err);
      }
    }
    return { items: assembleItems(topics, summary), counts, source: summary ? 'claude' : 'local' };
  }

  private firstName(): Promise<string | null> {
    this.gitName ??= this.deps.gitUser().then(
      (full) => full?.trim().split(/\s+/)[0] || null,
      () => null,
    );
    return this.gitName;
  }
}
