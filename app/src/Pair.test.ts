import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Pair from './Pair.svelte';

type Answer = { status: number; body: unknown };

const TOKEN: Answer = { status: 200, body: { token: 'tok-1', satellite: {} } };
const NO_CODE: Answer = { status: 404, body: { error: 'Pas de code ici' } };
/** A first device's code from the route, expiring at 14:32 on the browser's clock. */
const firstCodeOf = (code: string): Answer => ({
  status: 200,
  body: { code, expiresAt: new Date(2026, 10, 16, 14, 32).toISOString() },
});

/**
 * The fake server: `/first-code` answers apart, in order (a promise answers once settled), then
 * 404; the `pair` mock sees only `/pair`, whose answers come in order, then a token.
 */
function fakeServer(firsts: Array<Answer | Error | Promise<Answer>>, answers: Answer[] = []) {
  const respond = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status });
  const pair = vi.fn<typeof globalThis.fetch>(async () => respond(answers.shift() ?? TOKEN));
  const firstCode = vi.fn<typeof globalThis.fetch>(async () => {
    const a = await (firsts.shift() ?? NO_CODE);
    if (a instanceof Error) throw a;
    return respond(a);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>((input, init) =>
      (new URL(String(input)).pathname === '/first-code' ? firstCode : pair)(input, init),
    ),
  );
  return { pair, firstCode };
}

/** No first code: today's page. */
const server = (...answers: Answer[]) => fakeServer([], answers).pair;

const sent = (fetch: ReturnType<typeof server>, i = 0) =>
  JSON.parse(String(fetch.mock.calls[i]![1]?.body)) as { code: string };

/** Lets the answers already given reach the page. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const EXPIRES = 'Code du premier appareil. Il expire à 14:32.';

function setup(props: Partial<{ authorizing: boolean; notice: string }> = {}) {
  const onPaired = vi.fn<(token: string) => void>();
  // Before rendering: user-event provides the clipboard the page looks for.
  const user = userEvent.setup();
  render(Pair, { props: { baseUrl: 'http://avaritia.test', onPaired, ...props } });
  return { onPaired, user, code: screen.getByLabelText('Code à 6 chiffres') };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Pair', () => {
  it('is one standalone card that says where each code comes from', () => {
    server();
    const { code } = setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Relier ce navigateur' })).toBeInTheDocument();
    expect(screen.getByText('Saisir le code à 6 chiffres. Il ne sert qu’une fois.')).toBeInTheDocument();
    expect(code).toHaveFocus();
    expect(screen.getByText('Sur un appareil déjà relié')).toBeInTheDocument();
    expect(screen.getByText('Réglages › Appareils et applications › Relier un appareil')).toBeInTheDocument();
    expect(screen.getByText('Sur une installation neuve')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cette page, ouverte sur la machine qui héberge Lun'Avaritia, affiche le code du premier appareil.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Recours, dans un terminal de cette machine')).toBeInTheDocument();
    expect(screen.getByText('npm run pair-code')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Nouveau code' })).toBeNull();

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

  it('holds the first device’s code, says when it expires and that it is for this browser, sends it on « Relier »', async () => {
    const { pair, firstCode } = fakeServer([firstCodeOf('135790')]);
    const { onPaired, user, code } = setup();
    expect(await screen.findByText(EXPIRES)).toBeInTheDocument();
    expect(code).toHaveValue('135790');
    expect(code).toHaveAccessibleDescription(EXPIRES);
    expect(screen.getByRole('heading', { level: 1, name: 'Relier ce navigateur' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aucun appareil n'est encore appairé à Lun'Avaritia. Le code du premier appareil est déjà saisi : seule cette page, ouverte sur la machine qui l'héberge, l'affiche.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Ce code est pour ce navigateur.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pour relier une application : entrer, puis Réglages › Appareils et applications › Relier un appareil.',
      ),
    ).toBeInTheDocument();
    // The field does not leave by itself.
    expect(pair).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Relier' }));
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledExactlyOnceWith('tok-1'));
    expect(pair).toHaveBeenCalledOnce();
    expect(sent(pair).code).toBe('135790');
    expect(firstCode).toHaveBeenCalledOnce();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('holds the first device’s code the same way while an app waits for an authorization, without the other path', async () => {
    fakeServer([firstCodeOf('135790')]);
    const { code } = setup({ authorizing: true });
    expect(await screen.findByText(EXPIRES)).toBeInTheDocument();
    expect(code).toHaveValue('135790');
    expect(screen.getByText(/Le code du premier appareil est déjà saisi/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Étapes' })).toHaveTextContent(/Relier le navigateur.*Autoriser/);
    // The app already waits on this page: no sentence sending elsewhere.
    expect(screen.queryByText('Ce code est pour ce navigateur.')).toBeNull();
  });

  it('keeps digits typed before the first code arrives, and offers it again', async () => {
    let answer!: (a: Answer) => void;
    const { firstCode } = fakeServer([new Promise<Answer>((resolve) => (answer = resolve))]);
    const { user, code } = setup();
    await user.type(code, '48');
    answer(firstCodeOf('135790'));
    await vi.waitFor(() => expect(firstCode).toHaveBeenCalledOnce());
    await settled();
    expect(code).toHaveValue('48');
    expect(screen.queryByText(/déjà saisi/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Nouveau code' })).toBeInTheDocument();
  });

  it.each<[string, Answer | Error]>([
    ['answers 404', NO_CODE],
    ['answers 200 without a code', TOKEN],
    ['answers a code that is not six digits', { status: 200, body: { code: '48291', expiresAt: '' } }],
    ['fails', new TypeError('Failed to fetch')],
  ])(
    'leaves the field empty and says the three sources, the command last, when the route %s',
    async (_, first) => {
      const { firstCode } = fakeServer([first]);
      const { code } = setup();
      await vi.waitFor(() => expect(firstCode).toHaveBeenCalledOnce());
      await settled();
      expect(code).toHaveValue('');
      expect(screen.queryByText(/Code du premier appareil/)).toBeNull();
      expect(screen.getByRole('region', { name: 'Où trouver le code' })).toHaveTextContent(
        /Sur un appareil déjà relié.*Sur une installation neuve.*Recours, dans un terminal de cette machine.*npm run pair-code/,
      );
    },
  );

  it('offers « Nouveau code » for a refused first code, which asks the route once and fills the field', async () => {
    const { pair, firstCode } = fakeServer(
      [firstCodeOf('135790'), firstCodeOf('246802')],
      [{ status: 401, body: { error: 'Code d’appairage invalide, déjà utilisé ou expiré' } }],
    );
    const { onPaired, user, code } = setup();
    await screen.findByText(EXPIRES);
    expect(screen.queryByRole('button', { name: 'Nouveau code' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Relier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Code incorrect ou expiré. Demander un nouveau code.',
    );

    await user.click(screen.getByRole('button', { name: 'Nouveau code' }));
    await vi.waitFor(() => expect(code).toHaveValue('246802'));
    expect(firstCode).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(EXPIRES)).toBeInTheDocument();
    expect(code).toHaveFocus();
    // The new code does not leave by itself either.
    expect(pair).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Relier' }));
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledExactlyOnceWith('tok-1'));
    expect(sent(pair, 1).code).toBe('246802');
  });

  it.each<[string, Answer]>([
    [
      'refused first code',
      { status: 401, body: { error: 'Code d’appairage invalide, déjà utilisé ou expiré' } },
    ],
    ['first code lost to a failure', { status: 500, body: { error: 'Erreur interne' } }],
  ])('still offers « Nouveau code » once « Réessayer » clears a %s', async (_, answer) => {
    const { firstCode } = fakeServer([firstCodeOf('135790'), firstCodeOf('246802')], [answer]);
    const { user, code } = setup();
    await screen.findByText(EXPIRES);
    await user.click(screen.getByRole('button', { name: 'Relier' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(code).toHaveValue('');
    expect(screen.queryByText(/déjà saisi/)).toBeNull();
    expect(screen.getByText('Saisir le code à 6 chiffres. Il ne sert qu’une fois.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nouveau code' }));
    await vi.waitFor(() => expect(code).toHaveValue('246802'));
    expect(firstCode).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Le code du premier appareil est déjà saisi/)).toBeInTheDocument();
  });

  it('asks the route once at display and once per « Nouveau code », never by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { firstCode } = fakeServer(
      [firstCodeOf('135790'), firstCodeOf('246802')],
      [{ status: 401, body: { error: 'refusé' } }],
    );
    const { user } = setup();
    await screen.findByText(EXPIRES);
    vi.advanceTimersByTime(60 * 60_000);
    await settled();
    expect(firstCode).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Relier' }));
    await user.click(await screen.findByRole('button', { name: 'Nouveau code' }));
    await vi.waitFor(() => expect(firstCode).toHaveBeenCalledTimes(2));
    vi.advanceTimersByTime(60 * 60_000);
    await settled();
    expect(firstCode).toHaveBeenCalledTimes(2);
    // Fixed text: nothing turns to « expiré » by itself.
    expect(screen.getByText(EXPIRES)).toBeInTheDocument();
  });
});
