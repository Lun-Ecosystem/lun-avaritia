import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

const TOKEN_KEY = 'lunavaritia.token';

/** A fake Lun'Avaritia server: records each call as `METHOD /path`; `revoked` answers 401 to all. */
function fakeServer({ revoked = false } = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    calls.push(key);
    if (key === 'POST /lun/v1/pair') return json({ token: 'tok-2', satellite: {} });
    if (revoked) return json({ error: 'Jeton absent, invalide ou révoqué' }, 401);
    if (key === 'GET /lun/v1/health') return json({ status: 'paused', version: '0.0.0', agent: true });
    return json({ error: 'Introuvable' }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return { calls };
}

const authorizeQuery = (redirect = 'http://127.0.0.1:53682/callback') =>
  `/?${new URLSearchParams({
    autoriser: '1',
    client: 'Assistant local',
    redirect_uri: redirect,
    state: 'state-1',
    code_challenge: 'c'.repeat(43),
  })}`;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('asks a browser without a token for a pairing code', () => {
    fakeServer();
    render(App);
    expect(screen.getByRole('heading', { level: 1, name: 'Relier ce navigateur' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('pairs, keeps the token and shows the shell', async () => {
    fakeServer();
    const user = userEvent.setup();
    render(App);
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '042517');
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-2');
  });

  it('with a token, shows the shell on the route of the address', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', '/memoire');
    render(App);
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    expect(rail).toHaveTextContent("Lun'Avaritia");
    expect(within(rail).getByRole('link', { name: /Mémoire/ })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('link', { name: /Tableau de bord/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Mémoire' })).toBeInTheDocument();
  });

  it('follows the links of the rail without reloading, and the back button', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    const user = userEvent.setup();
    render(App);
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    await user.click(within(rail).getByRole('link', { name: /Dépôts/ }));
    expect(window.location.pathname).toBe('/depots');
    expect(within(rail).getByRole('link', { name: /Dépôts/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Dépôts' })).toBeInTheDocument();

    history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    await waitFor(() =>
      expect(within(rail).getByRole('link', { name: /Tableau de bord/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('shows the service state from the server in the rail', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    render(App);
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    expect(await within(rail).findByText('Traitement en pause')).toBeInTheDocument();
  });

  it('a 401 on the way clears the token and goes back to pairing, without a loop', async () => {
    const { calls } = fakeServer({ revoked: true });
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', '/valider');
    render(App);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Relier ce navigateur' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Cet appareil n’est plus reconnu.');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual(['GET /lun/v1/health']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('asks an unknown browser for a code, then resumes the authorization', async () => {
    fakeServer();
    history.replaceState(null, '', authorizeQuery());
    const user = userEvent.setup();
    render(App);

    expect(
      screen.getByText(
        "Lun'Avaritia ne connaît pas ce navigateur. Saisir le code à 6 chiffres pour continuer.",
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '042517');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: "Assistant local demande l’accès à Lun'Avaritia",
      }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-2');
    expect(window.location.search).toContain('autoriser=1');
  });

  it('refuses a return address outside the loopback and leaves without the request', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', authorizeQuery('http://localhost.evil.test/callback'));
    const user = userEvent.setup();
    render(App);

    expect(screen.getByRole('alert')).toHaveTextContent('Adresse de retour refusée');
    expect(screen.queryByRole('button', { name: 'Autoriser' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Ouvrir Lun'Avaritia" }));
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });
});
