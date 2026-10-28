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
  /** A failure shown in the thread, never sent back as a turn. */
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

  async send(text: string, context?: Record<string, string>): Promise<void> {
    const request = text.trim();
    if (!request || this.asking) return;
    const history = this.messages
      .filter((m) => !m.error)
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, MAX_CHARS) }));
    this.messages.push({ role: 'user', text: request });
    this.asking = true;
    try {
      const r = await this.#api.send<Reply>('POST', '/api/agent', {
        request: request.slice(0, MAX_CHARS),
        ...(context && { context }),
        history,
      });
      this.messages.push({ role: 'agent', text: r.summary, cost: r.cost.amount, drafts: r.cards.length });
    } catch (e) {
      const credit = e instanceof ApiError && (e.status === 402 || /crédit/i.test(e.message));
      const text = credit ? CREDIT : e instanceof Error && e.message ? e.message : 'L’agent ne répond pas.';
      this.messages.push({ role: 'agent', text, error: true });
    } finally {
      this.asking = false;
    }
  }

  clear(): void {
    this.messages = [];
  }
}

/** The panel, opened from anywhere (« Écrire une note » of an empty memory), with a request to start. */
export const agentPanel = $state({ open: false, draft: '' });

export function openAgent(draft = ''): void {
  agentPanel.draft = draft;
  agentPanel.open = true;
}
