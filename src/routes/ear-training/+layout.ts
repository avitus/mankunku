import { isBrowser } from '@supabase/ssr';
import { awaitHydration } from '$lib/state/hydration';
import type { LayoutLoad } from './$types';

/**
 * Ear Training pins the daily key, tempo, and lick roster ONCE at mount — a
 * deliberate session-start snapshot. The root layout
 * now hydrates cloud state in the background, so a cold load straight to this
 * route could snapshot pre-cloud localStorage (wrong daily key, stale tempo,
 * cloud-only licks missing from the rotation). Opt back into a bounded wait so
 * those pins are taken from hydrated state.
 *
 * `await parent()` guarantees the root layout load has run (and registered the
 * hydration promise) first. The bounded race preserves the prior worst case:
 * slow / offline degrades to pinning local state rather than hanging. After the
 * first hydration `awaitHydration()` resolves immediately, so re-navigation is
 * a microtask; anonymous users get the default-resolved promise (no wait).
 */
export const load: LayoutLoad = async ({ parent }) => {
	await parent();
	if (isBrowser()) await awaitHydration();
	return {};
};
