import type { WelcomeService } from '../../core/welcome/welcome-service';
import type { IpcHandlers } from '../dispatcher';

type WelcomeHandlers = Pick<
  IpcHandlers,
  'welcome:settings' | 'welcome:setSettings' | 'welcome:due' | 'welcome:recap' | 'welcome:seen'
>;

/** `suppressed`: os testes E2E não querem a tela por cima de cada abertura (só o teste dela a liga). */
export function welcomeHandlers(welcome: WelcomeService, suppressed: boolean): WelcomeHandlers {
  return {
    'welcome:settings': () => welcome.settings(),
    'welcome:setSettings': (patch) => welcome.setSettings(patch),
    'welcome:due': async ({ force }) => {
      const due = await welcome.due(force);
      return suppressed && !force ? { ...due, due: false } : due;
    },
    'welcome:recap': ({ workspaceId, since, label }) => welcome.recap(workspaceId, since, label),
    'welcome:seen': () => welcome.seen(),
  };
}
