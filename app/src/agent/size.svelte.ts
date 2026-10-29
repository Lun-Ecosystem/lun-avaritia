/*
 * The size of the agent's panel on a desktop (copied from Lun'Acedia's Pina): pulled by its edges or
 * the arrows, kept in the browser between visits, and back within the viewport when it shrinks.
 */

export interface Size {
  width: number;
  height: number;
}

export const MIN_SIZE: Size = { width: 340, height: 420 };
/** The panel never comes closer than this to the edges of the viewport, all margins together. */
export const MARGIN = 24;
export const DEFAULT_SIZE: Size = { width: 400, height: 600 };
export const SIZE_KEY = 'lunavaritia.agent.size';

/** At least 340 × 420, at most the viewport minus the margin (the minimum wins on a tiny viewport). */
export function clampSize(size: Size, viewport: Size): Size {
  const fit = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(v, max)));
  return {
    width: fit(size.width, MIN_SIZE.width, viewport.width - MARGIN),
    height: fit(size.height, MIN_SIZE.height, viewport.height - MARGIN),
  };
}

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

function loadSize(): Size {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as Partial<Size> | null;
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height))
      return clampSize(raw as Size, viewport());
  } catch {
    // Storage blocked or unreadable: the default size.
  }
  return clampSize(DEFAULT_SIZE, viewport());
}

export class PanelSize {
  size = $state<Size>(loadSize());
  /** The full height of the viewport, on the right. */
  maximized = $state(false);

  set(next: Size, save = false) {
    this.size = clampSize(next, viewport());
    if (!save) return;
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(this.size));
    } catch {
      // Not kept: the size holds for this visit only.
    }
  }

  /** Back within the bounds when the viewport shrinks. */
  fit() {
    this.size = clampSize(this.size, viewport());
  }
}
