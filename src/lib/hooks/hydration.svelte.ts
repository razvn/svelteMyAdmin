/**
 * Hydration state. SSR HTML is visible and clickable before Svelte hydrates, so controls that only work
 * with JS (bits-ui dialogs/menus/selects, client-built payloads) must be disabled until `hydration.ready`.
 * `markHydrated()` is called once from the root layout; it also sets `html[data-hydrated="true"]`, which
 * the CSS in app.css and the e2e helper `gotoReady` rely on. The root layout is never remounted by client
 * navigations, so the marker stays set.
 */
export const hydration = $state({ ready: false });

export function markHydrated() {
	hydration.ready = true;
	document.documentElement.dataset.hydrated = 'true';
}
