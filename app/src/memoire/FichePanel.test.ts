import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { detail, fakeApi } from './fixtures.ts';
import FichePanel from './FichePanel.svelte';

function show(details?: Record<number, unknown>, id = 1) {
  const f = fakeApi(details);
  const onOpen = vi.fn();
  render(FichePanel, { props: { id, onOpen }, context: new Map([['api', f.api]]) });
  return { ...f, onOpen };
}

describe('FichePanel', () => {
  it('shows title, type and update date', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
    expect(screen.getByText('Personnes')).toBeInTheDocument();
    expect(screen.getByText(/mise à jour le 28\/10/)).toBeInTheDocument();
  });

  it('opens a known linked fiche from the synthesis', async () => {
    const { onOpen } = show();
    const link = (await screen.findAllByRole('button', { name: 'Entreprise Z' }))[0]!;
    await userEvent.click(link);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(3));
  });

  it('lists active facts with source and date, struck facts in <s>', async () => {
    show();
    await screen.findByRole('heading', { name: 'Client X' });
    const active = screen.getByText('Demande une visio').closest('li')!;
    expect(active).toHaveTextContent('le core');
    expect(active).toHaveTextContent('27/10');
    const struck = screen.getByText('Recette le 3 juin');
    expect(struck.tagName).toBe('S');
    expect(struck.closest('li')).toHaveTextContent('barré le 20/10');
    expect(struck.closest('li')).toHaveTextContent('note-exemple');
  });

  it('shows neighbors with relation and direction', async () => {
    const { onOpen } = show();
    const out = (await screen.findByText('travaille chez →')).closest('li')!;
    expect(within(out).getByRole('button', { name: 'Entreprise Z' })).toBeInTheDocument();
    const into = screen.getByText('← concerne').closest('li')!;
    await userEvent.click(within(into).getByRole('button', { name: 'Entretien du 04/11' }));
    expect(onOpen).toHaveBeenCalledWith(4);
  });

  it('says when the asked fiche was merged here', async () => {
    show({ 1: detail({ redirectedFrom: 9 }) });
    expect(await screen.findByText('Fusionnée dans cette fiche')).toBeInTheDocument();
  });

  it('edits then shows the new version', async () => {
    const { send } = show();
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    const title = screen.getByLabelText('Titre');
    await userEvent.clear(title);
    await userEvent.type(title, 'Client Y');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('PATCH', '/api/fiches/1', {
        title: 'Client Y',
        synthesis: expect.any(String),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Client Y' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Titre')).toBeNull();
    expect(screen.getByText(/2 versions/)).toBeInTheDocument();
  });

  it('renders a hostile synthesis as text', async () => {
    const hostile = detail();
    hostile.fiche.synthesis = '<img src=x onerror=alert(1)>';
    const { container } = render(FichePanel, {
      props: { id: 1, onOpen: vi.fn() },
      context: new Map([['api', fakeApi({ 1: hostile }).api]]),
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows an unknown [[Titre]] as plain text, not a dead button', async () => {
    const d = detail();
    d.fiche.synthesis = 'Voir [[Entreprise Z]] et [[Titre inconnu]].';
    show({ 1: d });
    await screen.findByRole('heading', { name: 'Client X' });
    expect(screen.getAllByRole('button', { name: 'Entreprise Z' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Titre inconnu').tagName).not.toBe('BUTTON');
  });

  it('keeps a loaded fiche when the lists fail', async () => {
    const f = fakeApi();
    const real = f.get.getMockImplementation()!;
    f.get.mockImplementation(async (path: string) => {
      if (path === '/api/types' || path === '/api/fiches') throw new Error('indisponible');
      return real(path);
    });
    render(FichePanel, { props: { id: 1, onOpen: vi.fn() }, context: new Map([['api', f.api]]) });
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
    expect(screen.queryByText('indisponible')).toBeNull();
  });

  it('shows a refused save inline and keeps the edit', async () => {
    const f = fakeApi();
    f.send.mockRejectedValueOnce(new Error('Synthèse trop longue'));
    render(FichePanel, { props: { id: 1, onOpen: vi.fn() }, context: new Map([['api', f.api]]) });
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthèse trop longue');
    expect(screen.getByLabelText('Titre')).toBeInTheDocument();
  });
});
