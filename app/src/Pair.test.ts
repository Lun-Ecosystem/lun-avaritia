import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Pair from './Pair.svelte';

function server(...answers: Array<{ status: number; body: unknown }>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const a = answers.shift() ?? { status: 200, body: { token: 'tok-1', satellite: {} } };
    return new Response(JSON.stringify(a.body), { status: a.status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const sent = (fetch: ReturnType<typeof server>, i = 0) =>
  JSON.parse(String(fetch.mock.calls[i]![1]?.body)) as { code: string };

function setup(props: Partial<{ authorizing: boolean; notice: string }> = {}) {
  const onPaired = vi.fn<(token: string) => void>();
  // Before rendering: user-event provides the clipboard the page looks for.
  const user = userEvent.setup();
  render(Pair, { props: { baseUrl: 'http://avaritia.test', onPaired, ...props } });
  return { onPaired, user, code: screen.getByLabelText('Code à 6 chiffres') };
}

afterEach(() => vi.unstubAllGlobals());

describe('Pair', () => {
  it('is one standalone card that says where each code comes from', () => {
    server();
    const { code } = setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Relier ce navigateur' })).toBeInTheDocument();
    expect(screen.getByText('Saisir le code à 6 chiffres. Il ne sert qu’une fois.')).toBeInTheDocument();
    expect(code).toHaveFocus();
    expect(screen.getByText("Sur la machine qui héberge Lun'Avaritia")).toBeInTheDocument();
    expect(screen.getByText('npm run pair-code')).toBeInTheDocument();
    expect(screen.getByText('Sur un appareil déjà relié')).toBeInTheDocument();
    expect(screen.getByText('Réglages › Appareils et applications › Relier un appareil')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Étapes' })).toBeNull();
  });

  it('sends the code by itself at the sixth digit, pasted with its space', async () => {
    const fetch = server();
    const { onPaired, user, code } = setup();
    await user.click(code);
    await user.paste('482 917');
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledExactlyOnceWith('tok-1'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(sent(fetch)).toEqual({ code: '482917', client: "Lun'Avaritia (app)" });
  });

  it('sends a typed code at the sixth digit, not before', async () => {
    const fetch = server();
    const { onPaired, user, code } = setup();
    await user.type(code, '48291');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Relier' })).toBeDisabled();
    await user.type(code, '7');
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledOnce());
    expect(sent(fetch).code).toBe('482917');
  });

  it('says a refused code without telling whether it existed, then takes a new one', async () => {
    const fetch = server({
      status: 401,
      body: { error: 'Code d’appairage invalide, déjà utilisé ou expiré' },
    });
    const { onPaired, user, code } = setup();
    await user.type(code, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Code incorrect ou expiré. Demander un nouveau code.',
    );
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription('Code incorrect ou expiré. Demander un nouveau code.');
    expect(code).toHaveFocus();
    expect(onPaired).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(code).toHaveValue('');
    expect(code).toHaveFocus();
    await user.paste('482917');
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledExactlyOnceWith('tok-1'));
    expect(sent(fetch, 1).code).toBe('482917');
  });

  it('keeps digits typed over a refused code when Enter is pressed early', async () => {
    const fetch = server({ status: 401, body: { error: 'refusé' } });
    const { user, code } = setup();
    await user.type(code, '000000');
    await screen.findByRole('alert');
    await user.keyboard('48{Enter}');
    expect(code).toHaveValue('48');
    expect(code).toHaveFocus();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('shows the steps while an app waits for an authorization, the first one still to do', () => {
    server();
    setup({ authorizing: true });
    const steps = screen.getByRole('list', { name: 'Étapes' });
    expect(steps).toHaveTextContent(/Relier le navigateur.*Autoriser/);
    expect(screen.getByText('Relier le navigateur').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(steps).not.toHaveTextContent('Navigateur relié');
    expect(
      screen.getByText(
        "Lun'Avaritia ne connaît pas ce navigateur. Saisir le code à 6 chiffres pour continuer.",
      ),
    ).toBeInTheDocument();
  });

  it('copies the command', async () => {
    server();
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copier la commande' }));
    expect(writeText).toHaveBeenCalledWith('npm run pair-code');
    expect(await screen.findByRole('button', { name: 'Commande copiée' })).toBeInTheDocument();
  });

  it('keeps a notice from the app', () => {
    server();
    setup({ notice: "Ce navigateur n’a plus accès à Lun'Avaritia." });
    expect(screen.getByRole('status')).toHaveTextContent("Ce navigateur n’a plus accès à Lun'Avaritia.");
  });
});
