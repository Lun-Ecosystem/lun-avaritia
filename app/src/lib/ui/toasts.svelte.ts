/*
 * Toasts of the views: one store for the page, shown by the Toaster. A toast stays 6 s; an action
 * that can be undone gives its `undo`, run by the « Annuler » button or by Z on the last toast still
 * shown. An undo that fails replaces its toast by the error, in the danger tone.
 */

/** How long a toast stays, in ms (fixed value of the spec). */
export const TOAST_DURATION = 6000;

/** Toasts shown at once; an older one leaves when a new one comes. */
const MAX_SHOWN = 3;

export interface ToastOptions {
  undo?: (() => Promise<void>) | undefined;
  tone?: 'ok' | 'danger' | undefined;
}

export interface Toast {
  readonly id: number;
  message: string;
  tone: 'ok' | 'danger' | undefined;
  undo: (() => Promise<void>) | undefined;
  /** The undo is running: the button waits, Z does nothing more. */
  undoing: boolean;
}

const shown = $state<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function arm(id: number): void {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => dismiss(id), TOAST_DURATION),
  );
}

/** The toasts on screen, oldest first. */
export function toasts(): readonly Toast[] {
  return shown;
}

export function toast(message: string, options: ToastOptions = {}): void {
  const id = nextId++;
  shown.push({ id, message, tone: options.tone, undo: options.undo, undoing: false });
  while (shown.length > MAX_SHOWN) {
    const oldest = shown[0];
    if (oldest) dismiss(oldest.id);
  }
  arm(id);
}

export function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const index = shown.findIndex((t) => t.id === id);
  if (index !== -1) shown.splice(index, 1);
}

export function dismissAll(): void {
  for (const t of [...shown]) dismiss(t.id);
}

/** The last toast still shown that can be undone (target of Z). */
export function lastUndoable(): Toast | undefined {
  return shown.findLast((t) => t.undo && !t.undoing);
}

/** Runs the undo of a toast: it leaves on success, and becomes the error on failure. */
export async function undo(id: number): Promise<void> {
  const target = shown.find((t) => t.id === id);
  if (!target?.undo || target.undoing) return;
  target.undoing = true;
  clearTimeout(timers.get(id));
  try {
    await target.undo();
    dismiss(id);
  } catch (error) {
    const current = shown.find((t) => t.id === id);
    if (!current) return;
    current.message = error instanceof Error && error.message ? error.message : 'L’annulation a échoué.';
    current.tone = 'danger';
    current.undo = undefined;
    current.undoing = false;
    arm(id);
  }
}

/** Undoes the last toast still shown (Z). */
export function undoLast(): void {
  const target = lastUndoable();
  if (target) void undo(target.id);
}
