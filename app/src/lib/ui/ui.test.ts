import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FieldFixture from '../../testing/FieldFixture.svelte';
import TextAreaFixture from '../../testing/TextAreaFixture.svelte';
import Badge from './Badge.svelte';
import Button from './Button.svelte';
import { Archive } from './Icon.ts';
import IconButton from './IconButton.svelte';
import Segmented from './Segmented.svelte';
import Slider from './Slider.svelte';
import Switch from './Switch.svelte';
import { createRawSnippet } from 'svelte';

const text = (t: string) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));

describe('Field', () => {
  it('labels its control and shows the hint under it', () => {
    render(FieldFixture, { props: { hint: '6 chiffres, reçus sur l’appareil.' } });
    const input = screen.getByLabelText('Code d’appairage');
    expect(input).toHaveAccessibleDescription('6 chiffres, reçus sur l’appareil.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('with an error, no longer shows the hint and marks the control invalid', () => {
    render(FieldFixture, {
      props: { hint: '6 chiffres, reçus sur l’appareil.', error: '6 chiffres attendus.' },
    });
    const input = screen.getByLabelText('Code d’appairage');
    expect(screen.queryByText('6 chiffres, reçus sur l’appareil.')).toBeNull();
    expect(screen.getByText('6 chiffres attendus.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('6 chiffres attendus.');
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'jour', label: 'Jour' },
    { value: 'semaine', label: 'Semaine' },
    { value: 'mois', label: 'Mois' },
  ];

  it('emits the chosen value, and never an empty one', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Segmented, { props: { options, value: 'semaine', label: 'Période', onchange } });
    expect(screen.getByRole('group', { name: 'Période' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Mois' }));
    expect(onchange).toHaveBeenLastCalledWith('mois');
    await user.click(screen.getByRole('radio', { name: 'Mois' }));
    expect(onchange).toHaveBeenCalledOnce();
    expect(screen.getByRole('radio', { name: 'Mois' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('IconButton', () => {
  it('is named by its label', () => {
    render(IconButton, { props: { icon: Archive, label: 'Archiver', shortcut: 'E' } });
    const button = screen.getByRole('button', { name: 'Archiver' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'E');
  });
});

describe('Button', () => {
  it('while loading, keeps its text and ignores clicks', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, {
      props: { variant: 'principal', loading: true, onclick, children: text('Vérification…') },
    });
    const button = screen.getByRole('button', { name: 'Vérification…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });

  it('a disabled button does not act', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { props: { disabled: true, onclick, children: text('Enregistrer') } });
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onclick).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('acts at once and reports the new state', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Switch, { props: { label: 'Tri automatique', onchange } });
    const control = screen.getByRole('switch', { name: 'Tri automatique' });
    await user.click(control);
    expect(onchange).toHaveBeenCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Slider', () => {
  it('reads « 95 % » and clamps a typed value', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Slider, { props: { value: 95, label: 'Seuil de confiance', onchange } });
    expect(screen.getByRole('slider', { name: 'Seuil de confiance' })).toHaveAttribute(
      'aria-valuetext',
      '95 %',
    );
    const input = screen.getByRole('textbox', { name: 'Seuil de confiance' });
    await user.clear(input);
    await user.type(input, '140{Enter}');
    expect(onchange).toHaveBeenCalledWith(100);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('Badge', () => {
  it('carries its tone', () => {
    render(Badge, { props: { tone: 'ok', dot: true, children: text('Connecté') } });
    expect(screen.getByText('Connecté').parentElement).toHaveClass('ok');
  });

  it('takes the accent of the world', () => {
    render(Badge, { props: { tone: 'accent', children: text('doublon') } });
    expect(screen.getByText('doublon').parentElement).toHaveClass('accent');
  });
});

describe('TextArea', () => {
  it('is labelled by its Field and binds its value', async () => {
    const user = userEvent.setup();
    render(TextAreaFixture);
    const area = screen.getByLabelText('Synthèse');
    expect(area.tagName).toBe('TEXTAREA');
    await user.type(area, ' suite');
    expect(screen.getByText('Valeur : Texte suite')).toBeInTheDocument();
  });
});
