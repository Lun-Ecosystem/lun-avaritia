// The server's own limits (`/api/import`): a vault above them is refused before any sending.
export const MAX_FILES = 2000;
export const MAX_VAULT_CHARS = 20_000_000;

export interface Vault {
  files: { path: string; text: string }[];
  /** Files left out because they are not Markdown. */
  skipped: number;
  tooBig: boolean;
}

/** Keeps the `.md` files of a chosen folder, under their path relative to it. */
export async function readVault(files: File[]): Promise<Vault> {
  const notes = files.filter((f) => /\.md$/i.test(f.name));
  const skipped = files.length - notes.length;
  if (notes.length > MAX_FILES) return { files: [], skipped, tooBig: true };
  const read = await Promise.all(
    notes.map(async (f) => ({ path: f.webkitRelativePath || f.name, text: await f.text() })),
  );
  const chars = read.reduce((n, f) => n + f.text.length, 0);
  return chars > MAX_VAULT_CHARS
    ? { files: [], skipped, tooBig: true }
    : { files: read, skipped, tooBig: false };
}
