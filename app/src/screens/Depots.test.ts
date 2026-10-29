import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import Depots from './Depots.svelte';

const row = (id: number, name: string, pending: number, total: number) => ({
  id,
  name,
  type: 'text/markdown',
  size: 2048,
  createdAt: '2026-10-27T10:00:00Z',
  pending,
  total,
});

function show(opts: { rows?: unknown[]; upload?: () => unknown; send?: () => unknown } = {}) {
  const get = vi.fn(async () => ({ depots: opts.rows ?? [] }));
  const upload = vi.fn<(path: string, form: FormData) => Promise<unknown>>(async () =>
    opts.upload ? opts.upload() : { depot: 1, drafts: 1 },
  );
  const send = vi.fn(async () => (opts.send ? opts.send() : undefined));
  render(Depots, { context: new Map([['api', { get, send, upload } as unknown as Api]]) });
  return { get, upload, send };
}

function folder(files: [string, string, string][]) {
  return files.map(([name, text, path]) => {
    const f = new File([text], name);
    Object.defineProperty(f, 'webkitRelativePath', { value: path });
    return f;
  });
}

describe('Dépôts', () => {
  it('posts a chosen file as multipart and links to the drafts', async () => {
    const { upload } = show();
    const f = new File(['# Note'], 'note.md', { type: 'text/markdown' });
    await userEvent.setup().upload(screen.getByLabelText('Choisir un document'), f);
    await screen.findByText('Brouillon créé');
    const form = upload.mock.calls[0]![1] as unknown as FormData;
    expect(upload.mock.calls[0]![0]).toBe('/api/depots');
    expect((form.get('file') as File).name).toBe('note.md');
    expect(screen.getByRole('link', { name: 'Voir à valider' })).toHaveAttribute('href', '/valider');
  });

  it('shows the server message when a deposit is refused', async () => {
    show({
      upload: () => {
        throw new ApiError(400, 'PDF non pris en charge en v1');
      },
    });
    const f = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Choisir un document'), f);
    expect(await screen.findByText('PDF non pris en charge en v1')).toBeInTheDocument();
  });

  it('reports every file of a multi-file drop, even when one is refused', async () => {
    let call = 0;
    const { upload } = show({
      upload: () => {
        if (++call === 2) throw new ApiError(400, 'PDF non pris en charge en v1');
        return { depot: call, drafts: 1 };
      },
    });
    const files = [new File(['1'], 'a.md'), new File(['x'], 'b.pdf'), new File(['3'], 'c.md')];
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Choisir un document'), files);
    expect(await screen.findByText('2 brouillons créés')).toBeInTheDocument();
    expect(screen.getByText('2 sur 3 déposés. b.pdf : PDF non pris en charge en v1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir à valider' })).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('lists the deposits with their pending drafts', async () => {
    show({ rows: [row(2, 'contrat.md', 2, 5), row(1, 'idee.txt', 1, 1)] });
    expect(await screen.findByText('contrat.md')).toBeInTheDocument();
    expect(screen.getByText('2 brouillons en attente sur 5')).toBeInTheDocument();
    expect(screen.getByText('1 brouillon en attente sur 1')).toBeInTheDocument();
  });

  it('deletes a deposit after a confirmation', async () => {
    const { send } = show({ rows: [row(2, 'contrat.md', 0, 1)] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(send).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer le dépôt' });
    expect(confirm).toHaveClass('danger-plein');
    await user.click(confirm);
    await waitFor(() => expect(send).toHaveBeenCalledWith('DELETE', '/api/depots/2'));
  });

  it('imports an Obsidian vault and says what was left out', async () => {
    const { send } = show({ send: () => ({ draft: 4, notes: 2, warnings: [] }) });
    const files = folder([
      ['a.md', '# A', 'Coffre/a.md'],
      ['b.md', '# B', 'Coffre/b.md'],
      ['logo.png', 'x', 'Coffre/logo.png'],
    ]);
    await userEvent
      .setup({ applyAccept: false })
      .upload(screen.getByLabelText('Importer un coffre Obsidian'), files);
    expect(await screen.findByText('1 brouillon d’import, 2 notes')).toBeInTheDocument();
    expect(screen.getByText('1 fichier non Markdown ignoré')).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith('POST', '/api/import', {
      files: [
        { path: 'Coffre/a.md', text: '# A' },
        { path: 'Coffre/b.md', text: '# B' },
      ],
    });
  });

  it('refuses a vault that is too big without sending anything', async () => {
    const { send } = show();
    const files = folder([['a.md', 'x'.repeat(20_000_001), 'Coffre/a.md']]);
    await userEvent.setup().upload(screen.getByLabelText('Importer un coffre Obsidian'), files);
    expect(await screen.findByText('Coffre trop gros (20 Mo au plus)')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
});
