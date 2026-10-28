import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

const TOKEN_KEY = 'lunavaritia.token';

/** A fake Lun'Avaritia server: records each call as `METHOD /path`; `revoked` answers 401 to all. */
function fakeServer({ revoked = false, paused = true } = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    calls.push(key);
    if (key === 'POST /lun/v1/pair') return json({ token: 'tok-2', satellite: {} });
    if (revoked) return json({ error: 'Jeton absent, invalide ou révoqué' }, 401);
    if (key === 'POST /lun/v1/pause') {
      paused = true;
      return json({ status: 'paused' });
    }
    if (key === 'GET /lun/v1/health')
      return json({ status: paused ? 'paused' : 'ok', version: '0.0.0', agent: true });
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
    expect(screen.getByRole('searchbox', { name: 'Rechercher une fiche' })).toBeInTheDocument();
  });

  it('follows the links of the rail without reloading, and the back button', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    const user = userEvent.setup();
    render(App);
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    await user.click(within(rail).getByRole('link', { name: /Réglages/ }));
    expect(window.location.pathname).toBe('/reglages');
    expect(within(rail).getByRole('link', { name: /Réglages/ })).toHaveAttribute('aria-current', 'page');
    // The settings screen comes on demand.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Réglages' }, { timeout: 5000 }),
    ).toBeInTheDocument();

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

  it('Pause in the settings turns the service card of the rail to paused at once', async () => {
    fakeServer({ paused: false });
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', '/reglages');
    const user = userEvent.setup();
    render(App);
    const rail = await screen.findByRole('navigation', { name: 'Sections' });
    expect(await within(rail).findByText('Traitement actif')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Pause' }, { timeout: 5000 }));
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
    // Health, the rail counters and the queue fail once each; nothing retries.
    expect(calls.toSorted()).toEqual([
      'GET /api/dashboard',
      'GET /api/drafts',
      'GET /api/fiches',
      'GET /lun/v1/health',
    ]);
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

describe('App, edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a late 401 from the old token does not clear the token paired since', async () => {
    const calls: string[] = [];
    let lateHealth: (r: Response) => void = () => {};
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const auth = new Headers(init?.headers).get('authorization');
        const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname} ${auth ?? ''}`.trim();
        calls.push(key);
        if (key === 'GET /lun/v1/health Bearer tok-1') return new Promise((r) => (lateHealth = r));
        if (key === 'POST /lun/v1/pair') return json({ token: 'tok-2', satellite: {} });
        if (key === 'POST /api/authorizations Bearer tok-1') return json({ error: 'révoqué' }, 401);
        if (key === 'GET /lun/v1/health Bearer tok-2') return json({ status: 'ok' });
        return json({ error: 'Introuvable' }, 404);
      }),
    );
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', authorizeQuery());
    const user = userEvent.setup();
    render(App);

    // tok-1 is refused on the authorization: back to pairing, its health read still on the way.
    await user.click(screen.getByRole('button', { name: 'Autoriser' }));
    await user.type(await screen.findByLabelText('Code à 6 chiffres'), '042517');
    await screen.findByRole('button', { name: 'Autoriser' });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-2');

    lateHealth(json({ error: 'révoqué' }, 401));
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-2');
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeInTheDocument();
    expect(calls).toContain('GET /lun/v1/health Bearer tok-1');
  });

  it('only the links to a screen of the app stay in the page', async () => {
    fakeServer();
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    const user = userEvent.setup();
    render(App);
    await screen.findByRole('navigation', { name: 'Sections' });

    const kept: string[] = [];
    // Registered after the app's: sees its decision, then stops jsdom from navigating.
    const record = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a')!;
      if (e.defaultPrevented) kept.push(a.getAttribute('href')!);
      e.preventDefault();
    };
    window.addEventListener('click', record);
    const links = ['/memoire?type=personne', '/api/export', '/lun/v1/health', '/ailleurs'].map((href) => {
      const a = document.body.appendChild(document.createElement('a'));
      a.href = href;
      a.textContent = href;
      return a;
    });
    const download = document.body.appendChild(document.createElement('a'));
    download.href = '/depots';
    download.download = 'depots.md';
    download.textContent = 'download';
    try {
      for (const a of [...links, download]) await user.click(a);
    } finally {
      window.removeEventListener('click', record);
      for (const a of [...links, download]) a.remove();
    }
    expect(kept).toEqual(['/memoire?type=personne']);
    expect(window.location.pathname + window.location.search).toBe('/memoire?type=personne');
    expect(screen.getByRole('searchbox', { name: 'Rechercher une fiche' })).toBeInTheDocument();
  });

  it('pairs with storage blocked: the token lives in memory', async () => {
    fakeServer();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(App);
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '042517');
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });
});

describe('App, memory address', () => {
  it('back and forward follow the fiche opened in the memory', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body));
    const fiche = {
      id: 1,
      typeId: 1,
      title: 'Client X',
      synthesis: '',
      updatedAt: '2026-10-28T09:00:00Z',
      facts: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/fiches')
          return json({
            fiches: [{ id: 1, title: 'Client X', typeId: 1, type: 'Personnes', updatedAt: fiche.updatedAt }],
          });
        if (path === '/api/fiches/1') return json({ fiche, versions: [], neighbors: [], depots: [] });
        return json({ status: 'ok' });
      }),
    );
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    history.replaceState(null, '', '/memoire');
    const user = userEvent.setup();
    render(App);
    await user.click(await screen.findByRole('button', { name: 'Client X' }));
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
    history.back();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Client X' })).toBeNull());
    expect(window.location.search).toBe('');
    history.forward();
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
  });
});
