import { ApiError, type Api } from '../api.ts';

/*
 * The exchange with the agent, kept in the page only (nothing in the browser storage). The server keeps
 * no thread: each request carries the previous turns back.
 */

export type Message = {
  role: 'user' | 'agent';
  text: string;
  cost?: number;
  /** Drafts the answer created, to validate in « À valider ». */
  drafts?: number;
  /** A failure shown in the thread (and the request that failed): never sent back as a turn. */
  error?: boolean;
};

type Reply = { summary: string; cards: unknown[]; cost: { amount: number } };

/** The server takes 20 turns of 4000 characters at most. */
const MAX_TURNS = 20;
const MAX_CHARS = 4000;
const CREDIT = 'Crédit épuisé chez le fournisseur';

export class Conversation {
  messages = $state<Message[]>([]);
  /** A request is on its way. */
  asking = $state(false);

  #api: Api;

  constructor(api: Api) {
    this.#api = api;
  }

  /** `false` when the request failed: the caller may give it back to the field. */
  async send(text: string, context?: Record<string, string>): Promise<boolean> {
    const request = text.trim();
    if (!request || this.asking) return false;
    const history = this.messages
      .filter((m) => !m.error)
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, MAX_CHARS) }));
    const at = this.messages.push({ role: 'user', text: request }) - 1;
    this.asking = true;
    try {
      const r = await this.#api.send<Reply>('POST', '/api/agent', {
        request: request.slice(0, MAX_CHARS),
        ...(context && { context }),
        history,
      });
      this.messages.push({ role: 'agent', text: r.summary, cost: r.cost.amount, drafts: r.cards.length });
      return true;
    } catch (e) {
      const credit = e instanceof ApiError && (e.status === 402 || /crédit/i.test(e.message));
      const text = credit ? CREDIT : e instanceof Error && e.message ? e.message : 'L’agent ne répond pas.';
      // Out of the next history too: no two user turns in a row (unless the thread was cleared meanwhile).
      const turn = this.messages[at];
      if (turn?.role === 'user') turn.error = true;
      this.messages.push({ role: 'agent', text, error: true });
      return false;
    } finally {
      this.asking = false;
    }
  }

  clear(): void {
    this.messages = [];
  }
}

/** The agent's name and icon (`agent.name`, `agent.icon`), kept by whoever reads or saves the settings. */
export const agentIdentity = $state({ name: 'Agent', icon: 'sparkles' });

export function takeIdentity(settings: Record<string, unknown>): void {
  if (typeof settings['agent.name'] === 'string') agentIdentity.name = settings['agent.name'];
  if (typeof settings['agent.icon'] === 'string') agentIdentity.icon = settings['agent.icon'];
}

/** The panel, opened from anywhere (« Écrire une note » of an empty memory), with a request to start. */
export const agentPanel = $state({ open: false, draft: '' });

export function openAgent(draft = ''): void {
  agentPanel.draft = draft;
  agentPanel.open = true;
}
