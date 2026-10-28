// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import Catalogue from './Catalogue.svelte';

beforeAll(() => {
  // jsdom has no ResizeObserver; Bits UI measures the slider with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('catalogue page', () => {
  it('shows every section under the world of the app', () => {
    const { container } = render(Catalogue);
    expect(container.querySelector('[data-monde="avaritia"]')).not.toBeNull();
    for (const name of [
      'Boutons',
      'Champs',
      'Bascules et cases',
      'Pastilles et filtres',
      'Clavier',
      'L’IA visible et contrôlable',
      'Ce qui flotte : menus, info-bulles, dialogues, toasts',
      'Structures : listes, cartes de réglages, états vides, chargement',
      'Navigation : rail, onglets, palette de commandes',
      'Mobile et pages seules',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('receives the shortcuts, except from a field', async () => {
    const user = userEvent.setup();
    render(Catalogue);
    await user.keyboard('j');
    expect(screen.getByText(/Dernier raccourci reçu/)).toHaveTextContent('J');
    await user.click(screen.getByPlaceholderText('Taper J ou K ici'));
    await user.keyboard('k');
    expect(screen.getByText(/Dernier raccourci reçu/)).toHaveTextContent('J');
  });
});
