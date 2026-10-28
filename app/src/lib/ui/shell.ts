import { getContext, onDestroy, setContext, type Snippet } from 'svelte';
import type { ScreenContext } from '../types.ts';

/*
 * What the screen shown gives to the app shell around it: its main action on top of the rail, its
 * part of the rail (the boxes of the mail), and the gestures the palette and the mobile button call.
 * A view outside a shell (integrated by another app) finds no shell and shows these parts itself.
 */

export interface ScreenParts {
  /** Main action under the brand (« Nouveau message »). */
  action?: Snippet | undefined;
  /** Links of the screen, after the main links of the rail. */
  rail?: Snippet | undefined;
  /** Writes a new message (palette, floating button). */
  compose?: (() => void) | undefined;
  /** Creates the screen's own item (an event): the floating button on a phone, named `createLabel`. */
  create?: (() => void) | undefined;
  createLabel?: string | undefined;
  /** Searches the mails. */
  search?: ((query: string) => void) | undefined;
  /** The screen is at its start (the inbox): the main link of the rail shows as current. */
  readonly home?: boolean | undefined;
  /** Goes back to the start of the screen (a click on its main link while on it). */
  goHome?: (() => void) | undefined;
}

export type ShellRegister = (parts: ScreenParts | null) => void;

const KEY = Symbol('lun-shell');

/** For the shell: the screens inside call `register` with their parts, `null` when they leave. */
export const provideShell = (register: ShellRegister) => setContext(KEY, register);

/** For a screen: the shell around it, if any. */
export const shellOf = () => getContext<ShellRegister | undefined>(KEY);

/** The screen context, plus what the agent's context pill says of it (the subject of the mail open). */
export type ShownContext = {
  [K in Exclude<keyof ScreenContext, 'screen'>]?: ScreenContext[K] | undefined;
} & { screen: ScreenContext['screen']; label?: string | undefined };

/** Called with the context of the screen arriving, and with `null` when that one leaves. */
export type ContextSetter = (ctx: ShownContext | null, leaving?: ShownContext) => void;

const CONTEXT_KEY = Symbol('lun-screen-context');

/** For the app: receives what each screen shows, for the agent. */
export const provideScreenContext = (set: ContextSetter) => setContext(CONTEXT_KEY, set);

/**
 * For a screen, during its init: tells the agent what it shows. Give getters (`get mailId() {…}`) for what
 * changes: the context is read when the agent is asked. Nothing happens outside an app that listens.
 */
export function setScreenContext(ctx: ShownContext): void {
  const set = getContext<ContextSetter | undefined>(CONTEXT_KEY);
  if (!set) return;
  set(ctx);
  // The next screen may arrive before this one leaves: only this context is cleared.
  onDestroy(() => set(null, ctx));
}
