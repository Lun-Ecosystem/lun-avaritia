/** Types shared by the ui kit and the screens of the app. */

/** What the AI proposed for an item (ProposalCard, ProposalChip). */
export interface ProposalView {
  /** A box id, `trash`, `spam`, or `null` when no box fits (the proposal may still carry tags). */
  boxId: string | null;
  tagIds: string[];
  confidence: number;
  status: 'pending' | 'auto' | 'accepted' | 'corrected';
  /** Why the AI proposed this box (160 characters at most); absent for a rule or an older proposal. */
  reason?: string;
}

/** What the screen shown tells the agent. */
export interface ScreenContext {
  screen: 'tableau' | 'valider' | 'memoire' | 'depots' | 'reglages';
}
