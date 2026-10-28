export type Route = 'tableau' | 'valider' | 'memoire' | 'depots' | 'reglages';

/** The screens, in the order of the rail. */
export const ROUTES: Route[] = ['tableau', 'valider', 'memoire', 'depots', 'reglages'];

/** Address of each screen. */
export const pathOf = (route: Route): string => (route === 'tableau' ? '/' : `/${route}`);

/** The screen of an address; the dashboard for any other. */
export function routeFromPath(path: string): Route {
  const name = path.replace(/^\/+|\/+$/g, '');
  return ROUTES.find((r) => r === name) ?? 'tableau';
}
