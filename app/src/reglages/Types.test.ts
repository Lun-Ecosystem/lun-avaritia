import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import Types from './Types.svelte';

function show() {
  let types = [
    { id: 1, name: 'Personne' },
    { id: 2, name: 'Projet' },
  ];
  const get = vi.fn(async () => ({ types }));
  const send = vi.fn(async (method: string, path: string, body?: { name: string }): Promise<unknown> => {
    if (method === 'POST') {
      types = [...types, { id: 3, name: body!.name }];
      return { id: 3 };
    }
    if (method === 'PATCH') {
      types = types.map((t) => (path.endsWith(`/${t.id}`) ? { ...t, name: body!.name } : t));
      return { types };
    }
    if (path === '/api/types/1') throw new ApiError(400, 'Des fiches utilisent ce type.');
    types = types.filter((t) => !path.endsWith(`/${t.id}`));
    return undefined;
  });
  render(Types, { context: new Map([['api', { get, send, upload: vi.fn() } as unknown as Api]]) });
  return { send, user: userEvent.setup() };
}

describe('Types de fiches', () => {
  it('adds a type', async () => {
    const { send, user } = show();
    await screen.findByText('Personne');
    await user.type(screen.getByRole('textbox', { name: 'Nouveau type' }), 'Organisation');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(send).toHaveBeenCalledWith('POST', '/api/types', { name: 'Organisation' });
    expect(await screen.findByText('Organisation')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nouveau type' })).toHaveValue('');
  });

  it('renames a type', async () => {
    const { send, user } = show();
    await screen.findByText('Projet');
    await user.click(screen.getByRole('button', { name: 'Renommer Projet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Renommer le type' });
    const field = within(dialog).getByRole('textbox', { name: 'Nom' });
    await user.clear(field);
    await user.type(field, 'Chantier');
    await user.click(within(dialog).getByRole('button', { name: 'Renommer' }));
    expect(send).toHaveBeenCalledWith('PATCH', '/api/types/2', { name: 'Chantier' });
    expect(await screen.findByText('Chantier')).toBeInTheDocument();
  });

  it('removing a type in use shows the error of the server', async () => {
    const { user } = show();
    await screen.findByText('Personne');
    await user.click(screen.getByRole('button', { name: 'Retirer Personne' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Retirer le type' }));
    expect(await within(dialog).findByText('Des fiches utilisent ce type.')).toBeInTheDocument();
    expect(screen.getByText('Personne')).toBeInTheDocument();
  });

  it('removing an empty type goes through the confirmation', async () => {
    const { send, user } = show();
    await screen.findByText('Projet');
    await user.click(screen.getByRole('button', { name: 'Retirer Projet' }));
    expect(send).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Retirer le type Projet ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Retirer le type' }));
    expect(send).toHaveBeenCalledWith('DELETE', '/api/types/2');
    await expect.poll(() => screen.queryByText('Projet')).toBeNull();
  });
});
