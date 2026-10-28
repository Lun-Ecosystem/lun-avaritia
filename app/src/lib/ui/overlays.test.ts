import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeInput from './CodeInput.svelte';
import ConfirmDialog from './ConfirmDialog.svelte';
import { Archive } from './Icon.ts';
import IconButton from './IconButton.svelte';
import Toaster from './Toaster.svelte';
import { dismissAll, toast } from './toasts.svelte.ts';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    dismissAll();
    vi.useRealTimers();
  });

  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

  it('Z runs the undo of the toast, which then goes away', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.resolve());
    toast('3 mails rangés dans Factures', { undo });
    await tick();
    expect(screen.getByText('3 mails rangés dans Factures')).toBeInTheDocument();

    await user().keyboard('z');
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('3 mails rangés dans Factures')).toBeNull();
  });

  it('an undo that fails replaces the toast by its message, in the danger tone', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.reject(new Error('Le mail a changé depuis, annulation refusée.')));
    toast('Rangé dans Administratif', { undo });
    await tick();

    await user().click(screen.getByRole('button', { name: 'Annuler' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('Rangé dans Administratif')).toBeNull();
    const message = screen.getByText('Le mail a changé depuis, annulation refusée.');
    expect(message.closest('[data-ton]')).toHaveAttribute('data-ton', 'danger');
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('stays 6 s, then goes away', async () => {
    render(Toaster);
    toast('Réglage enregistré');
    await tick();
    await vi.advanceTimersByTimeAsync(5999);
    expect(screen.getByText('Réglage enregistré')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Réglage enregistré')).toBeNull();
  });

  it('Z does nothing once the toast is gone', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.resolve());
    toast('Archivé', { undo });
    await vi.advanceTimersByTimeAsync(6000);
    await user().keyboard('z');
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('CodeInput', () => {
  it.each(['482 917', '482·917'])('a paste of « %s » completes with 482917', async (pasted) => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.click(input);
    await user.paste(pasted);
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
    expect(input).toHaveValue('482917');
  });

  it('outside a Field, is described by the id it is given', () => {
    render(CodeInput, { props: { error: true, 'aria-describedby': 'pourquoi' } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    expect(input).toHaveAttribute('aria-describedby', 'pourquoi');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('a refused code pasted again completes again (retry)', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { value: '482917', error: true, oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.click(input);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('482 917');
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
    expect(input).toHaveValue('482917');
  });

  it('a key typed into a full code sends nothing more', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.type(input, '482917');
    expect(oncomplete).toHaveBeenCalledOnce();
    await user.type(input, '3');
    await user.type(input, '45');
    expect(oncomplete).toHaveBeenCalledOnce();
    expect(input).toHaveValue('482917');
  });

  it('a full code given by the parent, then a key typed: nothing sent', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { value: '482917', oncomplete } });
    await user.type(screen.getByRole('textbox', { name: 'Code à 6 chiffres' }), '3');
    expect(oncomplete).not.toHaveBeenCalled();
  });

  it('keeps only the digits typed, and completes at the sixth', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.type(input, '48a2 9');
    expect(input).toHaveValue('4829');
    expect(oncomplete).not.toHaveBeenCalled();
    await user.type(input, '17');
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
  });
});

/** Lets Bits finish opening a layer (focus scope, escape layer) before a key is pressed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('ConfirmDialog', () => {
  const props = {
    title: 'Retirer Safari sur iPhone ?',
    message: 'Cet appareil perdra l’accès à Lun’Avaritia.',
    confirmLabel: 'Retirer l’appareil',
  };

  it('calls onconfirm only on a click of its button', async () => {
    const user = userEvent.setup();
    const onconfirm = vi.fn(() => Promise.resolve());
    const { rerender } = render(ConfirmDialog, { props: { ...props, open: true, onconfirm } });
    expect(screen.getByRole('alertdialog', { name: props.title })).toBeInTheDocument();
    expect(onconfirm).not.toHaveBeenCalled();

    await settle();
    await user.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await rerender({ open: true });
    await settle();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onconfirm).not.toHaveBeenCalled();

    await rerender({ open: true });
    await settle();
    await user.click(screen.getByRole('button', { name: 'Retirer l’appareil' }));
    expect(onconfirm).toHaveBeenCalledOnce();
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('can confirm with the full danger button', () => {
    render(ConfirmDialog, {
      props: { ...props, open: true, onconfirm: vi.fn(), confirmVariant: 'danger-plein' },
    });
    expect(screen.getByRole('button', { name: props.confirmLabel })).toHaveClass('danger-plein');
  });

  it('stays open and says why when the action fails', async () => {
    const user = userEvent.setup();
    const onconfirm = vi.fn(() => Promise.reject(new Error('Le serveur ne répond pas.')));
    render(ConfirmDialog, { props: { ...props, open: true, onconfirm } });
    await user.click(screen.getByRole('button', { name: 'Retirer l’appareil' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Le serveur ne répond pas.')).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('a handler given by the caller keeps the tooltip working', async () => {
    const user = userEvent.setup();
    const onfocus = vi.fn();
    render(IconButton, { props: { icon: Archive, label: 'Archiver', shortcut: 'E', onfocus } });
    await user.tab();
    const button = screen.getByRole('button', { name: 'Archiver' });
    expect(button).toHaveFocus();
    expect(onfocus).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('data-state');
    expect(button).not.toHaveAttribute('data-state', 'closed');
  });
});
