import { describe, expect, it } from 'vitest';
import { pathOf, routeFromPath, ROUTES } from './routes.ts';

describe('routes', () => {
  it('each route has its path, and its path leads back to it', () => {
    expect(ROUTES.map(pathOf)).toEqual(['/', '/valider', '/memoire', '/depots', '/reglages']);
    for (const route of ROUTES) expect(routeFromPath(pathOf(route))).toBe(route);
  });

  it('an unknown path or a trailing slash is handled', () => {
    expect(routeFromPath('/memoire/')).toBe('memoire');
    expect(routeFromPath('/nulle-part')).toBe('tableau');
    expect(routeFromPath('')).toBe('tableau');
  });
});
