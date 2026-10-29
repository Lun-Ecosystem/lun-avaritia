import { icons, type IconComponent } from '../lib/ui/index.ts';

/** The eight icons of the agent (`agent.icon` on the server), shared by the settings and the bubble. */
export const AGENT_ICONS = {
  sparkles: { label: 'Étincelles', icon: icons.Sparkles },
  brain: { label: 'Cerveau', icon: icons.Brain },
  'book-open': { label: 'Livre ouvert', icon: icons.BookOpen },
  library: { label: 'Bibliothèque', icon: icons.Library },
  feather: { label: 'Plume', icon: icons.Feather },
  moon: { label: 'Lune', icon: icons.Moon },
  gem: { label: 'Gemme', icon: icons.Gem },
  scroll: { label: 'Parchemin', icon: icons.Scroll },
} satisfies Record<string, { label: string; icon: IconComponent }>;

export type AgentIcon = keyof typeof AGENT_ICONS;

/** The icon of a name sent by the server; an unknown one falls back to the default. */
export const agentIcon = (name: string): IconComponent =>
  (AGENT_ICONS[name as AgentIcon] ?? AGENT_ICONS.sparkles).icon;
