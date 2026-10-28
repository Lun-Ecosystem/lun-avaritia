import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api.ts';
import Authorize from './Authorize.svelte';

const request = {
  client: 'Assistant local',
  redirect_uri: 'http://127.0.0.1:53682/callback',
  state: 'state-1',
  code_challenge: 'challenge-1',
};

function setup(over: Partial<typeof request> = {}) {
  const authorize = vi.fn(async (_method: string, _path: string, body?: unknown) => {
    const req = body as typeof request & { decision: string };
    return { redirect: `${req.redirect_uri}?decision=${req.decision}` };
  });
  const navigate = vi.fn<(url: string) => void>();
  const api = { send: authorize } as unknown as Api;
  render(Authorize, { props: { api, request: { ...request, ...over }, navigate } });
  return { authorize, navigate, user: userEvent.setup() };
}

describe('Authorize', () => {
  it('Authorize shows the client name and the return host:port, and follows the redirect', async () => {
    const { authorize, navigate, user } = setup();
    expect(
      screen.getByRole('heading', { level: 1, name: "Assistant local demande l’accès à Lun'Avaritia" }),
    ).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:53682')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:53682').closest('p')).toHaveTextContent(
      'Retour ensuite vers 127.0.0.1:53682',
    );
    expect(
      screen.getByText('Accès retirable à tout moment dans Réglages › Appareils et applications.'),
    ).toBeInTheDocument();
    expect(authorize).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Autoriser' }));
    expect(authorize).toHaveBeenCalledExactlyOnceWith('POST', '/api/authorizations', {
      ...request,
      decision: 'allow',
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:53682/callback?decision=allow');
  });

  it('lists the four rights, each with its icon', () => {
    setup();
    const rights = within(screen.getByRole('list', { name: 'Droits demandés' })).getAllByRole('listitem');
    expect(rights.map((li) => li.textContent?.trim())).toEqual([
      'Lire l’état, les coûts et les événements',
      'Lire et trancher les cartes à valider',
      'Interroger l’agent et lancer ses actions',
      'Mettre en pause et reprendre le service',
    ]);
    for (const li of rights) expect(li.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows the first step done, the second current, and the two buttons side by side, same size class', () => {
    setup();
    expect(screen.getByRole('list', { name: 'Étapes' })).toHaveTextContent(/Navigateur relié.*Autoriser/);
    expect(screen.getByText('Navigateur relié', { exact: false }).closest('li')).not.toHaveAttribute(
      'aria-current',
    );
    const deny = screen.getByRole('button', { name: 'Refuser' });
    const allow = screen.getByRole('button', { name: 'Autoriser' });
    // Same size: both fill half of one row; the refusal is a real button, not a link.
    expect(deny.parentElement).toBe(allow.parentElement);
    expect(deny.parentElement).toHaveClass('boutons');
    expect(deny).toHaveClass('grand');
    expect(allow).toHaveClass('grand');
  });

  it('shows the return host exactly as validated, as text only', () => {
    setup({ redirect_uri: 'http://localhost/cb' });
    expect(screen.getByText('localhost:80')).toBeInTheDocument();
  });

  it('sends the refusal and follows its redirect', async () => {
    const { authorize, navigate, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(authorize).toHaveBeenCalledExactlyOnceWith('POST', '/api/authorizations', {
      ...request,
      decision: 'deny',
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:53682/callback?decision=deny');
  });

  it('shows the client name as text only', () => {
    setup({ client: '<img src=x onerror=alert(1)>' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      "<img src=x onerror=alert(1)> demande l’accès à Lun'Avaritia",
    );
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the error and allows a new try when the server refuses', async () => {
    const { authorize, navigate, user } = setup();
    authorize.mockRejectedValueOnce(new Error('Seul un appareil relié peut autoriser une application'));
    await user.click(screen.getByRole('button', { name: 'Autoriser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seul un appareil relié');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeEnabled();
  });
});
