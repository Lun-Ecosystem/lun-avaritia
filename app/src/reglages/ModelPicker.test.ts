import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ModelPicker from './ModelPicker.svelte';
import type { ModelOffer } from './types.ts';

// What jsdom lacks for Bits Select to open: it captures the pointer.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const MODELS: ModelOffer[] = [
  {
    provider: 'anthropic',
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    price: { input: 0.1, output: 0.5 },
    tier: '€',
  },
  { provider: 'openai', id: 'gpt-maison', label: 'GPT maison', tier: null },
];

describe('ModelPicker', () => {
  it('says the provider and the price, « prix inconnu » without one', async () => {
    const onchange = vi.fn();
    const user = userEvent.setup();
    const value = { provider: 'anthropic' as const, model: 'claude-haiku-5-5' };
    render(ModelPicker, { props: { label: 'Modèle des lots', models: MODELS, value, onchange } });
    const trigger = screen.getByRole('combobox', { name: 'Modèle des lots' });
    expect(trigger).toHaveTextContent('Claude Haiku 5.5');
    expect(screen.getByText('Anthropic · 0,10 / 0,50 $ par M jetons')).toBeInTheDocument();

    await user.click(trigger);
    const options = await screen.findAllByRole('option', { hidden: true });
    expect(options.map((o) => o.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Claude Haiku 5.5 Anthropic · 0,10 / 0,50 $ par M jetons · €',
      'GPT maison OpenAI · prix inconnu',
    ]);
    await user.click(within(options[1]!).getByText('GPT maison'));
    expect(onchange).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-maison' });
  });

  it('without a model offered, says no key is in service', () => {
    render(ModelPicker, {
      props: { label: 'Modèle de l’agent', models: [], value: null, onchange: vi.fn() },
    });
    const trigger = screen.getByRole('combobox', { name: 'Modèle de l’agent' });
    expect(trigger).toHaveTextContent('Aucune clé en service');
    expect(trigger).toBeDisabled();
  });
});
