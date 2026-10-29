/** WebGL available? The probe context is released at once: browsers cap live WebGL contexts. */
export function hasWebGL(canvas: HTMLCanvasElement = document.createElement('canvas')): boolean {
  const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  ctx?.getExtension('WEBGL_lose_context')?.loseContext();
  return !!ctx;
}
